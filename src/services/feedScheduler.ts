import type { Client } from 'discord.js';
import { getPrisma } from './db.js';
import { logger } from './logger.js';
import { fetchFeed, matchesFilters } from './feeds.js';
import { RateLimitError } from '../utils/errors.js';
import { deliverDigest, type DeliverableItem } from './feedDelivery.js';

/**
 * Polling and delivery.
 *
 * Two things keep this from becoming a nuisance to the sites it reads and to
 * the people it writes to:
 *
 *  - A feed is polled once no matter how many people follow it, on a schedule
 *    that backs off when it fails. Fifty subscriptions at five-minute
 *    intervals would be 14,400 requests a day and Reddit would block us well
 *    before that.
 *  - A DM that Discord refuses pauses the subscription instead of retrying.
 *    Someone with DMs closed must not generate a failure every hour forever.
 */

/** How often the loop wakes. Individual feeds are polled far less often. */
const TICK_MS = 5 * 60 * 1000;
/** Normal interval between polls of one feed. */
const POLL_INTERVAL_MS = 30 * 60 * 1000;
/** Feeds checked per tick, so a large subscription list spreads out. */
const FEEDS_PER_TICK = 12;
/** Consecutive failures before a feed is left alone entirely. */
const MAX_FAILURES = 8;
/** Items kept per feed. Older ones are pruned; they are only needed for dedupe. */
const ITEM_RETENTION = 200;

let timer: NodeJS.Timeout | undefined;

/** Failure backoff: 30m, 1h, 2h, 4h… capped at a day. */
function backoffMs(failures: number): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** failures, 24 * 60 * 60 * 1000);
}

/**
 * Minimum gap between polls of one host.
 *
 * Reddit rate-limits an anonymous client hard — it did so within a handful of
 * requests while this was being built — so its feeds are read on a much longer
 * leash than the default. Nothing on a subreddit is urgent enough to argue
 * with that.
 */
function hostInterval(url: string): number {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)reddit\.com$/i.test(host)) return 60 * 60 * 1000;
  } catch {
    // A malformed stored URL falls back to the default, and will fail its
    // next poll anyway.
  }
  return POLL_INTERVAL_MS;
}

/**
 * Polls one feed and records anything new.
 *
 * Returns the items that were genuinely new, which is what delivery then
 * filters per subscriber. Nothing is delivered from here — a feed's first poll
 * after being added would otherwise dump its entire back catalogue into
 * someone's DMs.
 */
async function pollSource(sourceId: string): Promise<number> {
  const prisma = getPrisma();
  const source = await prisma.feedSource.findUnique({ where: { id: sourceId } });
  if (!source) return 0;

  try {
    const result = await fetchFeed(source.url, {
      etag: source.etag,
      lastModified: source.lastModified,
    });

    // 304: nothing changed, and nothing to do but record that we looked.
    if (!result.feed) {
      await prisma.feedSource.update({
        where: { id: sourceId },
        data: { lastCheckedAt: new Date(), failureCount: 0, lastError: null },
      });
      return 0;
    }

    let added = 0;

    for (const item of result.feed.items) {
      // createMany with skipDuplicates would be fewer queries, but the unique
      // constraint is what makes this idempotent and we need the count.
      const created = await prisma.feedItem
        .create({
          data: {
            sourceId,
            guid: item.guid,
            title: item.title,
            link: item.link,
            author: item.author,
            summary: item.summary,
            imageUrl: item.imageUrl,
            publishedAt: item.publishedAt,
          },
        })
        .catch(() => null);

      if (created) added++;
    }

    await prisma.feedSource.update({
      where: { id: sourceId },
      data: {
        lastCheckedAt: new Date(),
        failureCount: 0,
        lastError: null,
        etag: result.etag ?? null,
        lastModified: result.lastModified ?? null,
        // A feed that starts working again keeps its title current.
        title: result.feed.title || source.title,
        siteUrl: result.feed.siteUrl ?? source.siteUrl,
        iconUrl: result.feed.iconUrl ?? source.iconUrl,
      },
    });

    await pruneItems(sourceId);
    return added;
  } catch (err) {
    // Being rate limited says nothing about the feed's health — it says we
    // asked too often. Counting it toward the failure budget would eventually
    // disable a perfectly good feed for the crime of being popular. Reddit
    // rate-limited this within a handful of requests during development, so
    // this path is the common one, not the exceptional one.
    if (err instanceof RateLimitError) {
      await prisma.feedSource.update({
        where: { id: sourceId },
        data: {
          // Pushed forward so the next poll is due after the cooldown rather
          // than on the next tick.
          lastCheckedAt: new Date(Date.now() + (err.retryAfterSeconds ?? 900) * 1000),
          lastError: `Rate limited by ${err.service}`,
        },
      });
      logger.debug({ url: source.url }, 'Feed rate limited; backing off');
      return 0;
    }

    const failures = source.failureCount + 1;

    await prisma.feedSource.update({
      where: { id: sourceId },
      data: {
        lastCheckedAt: new Date(),
        failureCount: failures,
        lastError: (err as Error).message.slice(0, 300),
        // Given up on, but kept: the subscription list should say why rather
        // than the feed silently going quiet.
        disabledAt: failures >= MAX_FAILURES ? new Date() : null,
      },
    });

    logger.debug({ err, url: source.url, failures }, 'Feed poll failed');
    return 0;
  }
}

/** Keeps the dedupe set bounded; old items serve no other purpose. */
async function pruneItems(sourceId: string): Promise<void> {
  const prisma = getPrisma();
  const cutoff = await prisma.feedItem.findMany({
    where: { sourceId },
    orderBy: { seenAt: 'desc' },
    skip: ITEM_RETENTION,
    take: 1,
    select: { seenAt: true },
  });

  if (cutoff.length === 0) return;
  await prisma.feedItem.deleteMany({
    where: { sourceId, seenAt: { lt: cutoff[0]!.seenAt } },
  });
}

/**
 * Items a subscriber has not been sent yet, after their filters.
 *
 * Exported because /feed read answers the same question on demand.
 */
export async function pendingFor(subscriptionId: string, limit = 25): Promise<DeliverableItem[]> {
  const prisma = getPrisma();

  const subscription = await prisma.feedSubscription.findUnique({
    where: { id: subscriptionId },
    include: { source: true },
  });
  if (!subscription) return [];

  const items = await prisma.feedItem.findMany({
    where: {
      sourceId: subscription.sourceId,
      deliveries: { none: { subscriptionId } },
    },
    orderBy: [{ publishedAt: 'desc' }, { seenAt: 'desc' }],
    take: limit * 3,
  });

  return items
    .filter((item) => matchesFilters(item, subscription))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.title,
      link: item.link,
      author: item.author,
      summary: item.summary,
      imageUrl: item.imageUrl,
      publishedAt: item.publishedAt,
      feedTitle: subscription.label ?? subscription.source.title,
      feedIcon: subscription.source.iconUrl,
    }));
}

/**
 * Marks everything currently in a feed as already seen by a new subscriber.
 *
 * Following a feed should start the clock, not hand over its archive. The
 * obvious implementation — ignore items older than the subscription — does not
 * work, because the seeding poll necessarily runs *after* the subscription
 * exists, so every item it stores looks newer than the subscription and the
 * first digest arrives with the whole front page in it.
 *
 * Recording them as delivered instead is unambiguous: only what shows up on a
 * later poll is ever new.
 */
export async function seedSubscription(subscriptionId: string): Promise<number> {
  const prisma = getPrisma();

  const subscription = await prisma.feedSubscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!subscription) return 0;

  const existing = await prisma.feedItem.findMany({
    where: { sourceId: subscription.sourceId },
    select: { id: true },
  });

  await Promise.all(
    existing.map((item) =>
      prisma.feedDelivery.create({ data: { subscriptionId, itemId: item.id } }).catch(() => null),
    ),
  );

  return existing.length;
}

/** Records items as sent, so they never arrive twice. */
export async function markDelivered(subscriptionId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;

  const prisma = getPrisma();

  // One at a time because SQLite has no skipDuplicates. The unique constraint
  // is what makes this safe to call twice for the same item — a second attempt
  // fails harmlessly rather than sending it again.
  await Promise.all(
    itemIds.map((itemId) =>
      prisma.feedDelivery.create({ data: { subscriptionId, itemId } }).catch(() => null),
    ),
  );

  await prisma.feedSubscription.update({
    where: { id: subscriptionId },
    data: { lastSentAt: new Date(), deliveredCount: { increment: itemIds.length } },
  });
}

/**
 * Sends what is due to one subscriber.
 *
 * A closed DM pauses the subscription rather than failing forever. The note is
 * shown in /feed list so it does not look like the feed simply stopped.
 */
async function deliverTo(
  client: Client,
  subscription: { id: string; userId: string; mode: string },
): Promise<void> {
  const items = await pendingFor(subscription.id);
  if (items.length === 0) return;

  try {
    const user = await client.users.fetch(subscription.userId);
    await deliverDigest(user, items);
    await markDelivered(
      subscription.id,
      items.map((item) => item.id),
    );
  } catch (err) {
    logger.info({ err, userId: subscription.userId }, 'Feed delivery failed; pausing');

    await getPrisma()
      .feedSubscription.update({
        where: { id: subscription.id },
        data: {
          paused: true,
          pauseNote: 'Paused because a DM could not be delivered. Open your DMs and resume it.',
        },
      })
      .catch(() => {});
  }
}

async function tick(client: Client): Promise<void> {
  const prisma = getPrisma();

  try {
    // Feeds nobody follows any more are not worth polling.
    const sources = await prisma.feedSource.findMany({
      where: {
        disabledAt: null,
        subscriptions: { some: { paused: false } },
      },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: FEEDS_PER_TICK,
    });

    const now = Date.now();

    for (const source of sources) {
      const interval = Math.max(backoffMs(source.failureCount), hostInterval(source.url));
      const due = !source.lastCheckedAt || now - source.lastCheckedAt.getTime() >= interval;

      if (due) await pollSource(source.id);
    }

    // Instant subscriptions go out as soon as a poll finds something.
    const instant = await prisma.feedSubscription.findMany({
      where: { mode: 'instant', paused: false },
      select: { id: true, userId: true, mode: true },
    });

    for (const subscription of instant) await deliverTo(client, subscription);

    // Digests go out in their chosen hour, once.
    const hour = new Date().getUTCHours();
    const digests = await prisma.feedSubscription.findMany({
      where: { mode: 'digest', paused: false, digestHour: hour },
      select: { id: true, userId: true, mode: true, lastSentAt: true },
    });

    for (const subscription of digests) {
      const sentThisHour =
        subscription.lastSentAt && now - subscription.lastSentAt.getTime() < 60 * 60 * 1000;
      if (!sentThisHour) await deliverTo(client, subscription);
    }
  } catch (err) {
    logger.error({ err }, 'Feed scheduler tick failed');
  }
}

export function startFeedScheduler(client: Client): void {
  if (timer) return;

  // 'manual' subscriptions are never polled on their own account; they ride
  // along with whoever else follows the same source, and /feed read shows the
  // backlog. A source followed only by manual subscribers is still polled,
  // because otherwise there would be nothing to read.
  timer = setInterval(() => void tick(client), TICK_MS);
  timer.unref();

  void tick(client);
  logger.info('Feed scheduler started');
}

export function stopFeedScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

export { pollSource };
