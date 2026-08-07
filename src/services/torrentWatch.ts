import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

import { getPrisma } from './db.js';
import { logger } from './logger.js';
import { Torrent1337xError } from './1337x.js';
import { searchSources } from './sources/index.js';
import { parseReleaseName, qualityLabel, episodeLabel } from './releaseName.js';
import { ZENITSU_THEME } from '../utils/constants.js';

/**
 * Re-runs saved searches and announces releases that were not there before.
 *
 * Polls rather than holding timers, for the same reason the reminder scheduler
 * does: a watch set before a restart has to survive it.
 *
 * The request budget is the thing to be careful with. Every watch costs a real
 * search across every index, so watches are checked at a slow interval and only
 * a handful per tick. Each is searched newest-first: a release a watch is
 * waiting for is by definition new, and sorting by seeders would bury it.
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Each watch is only re-run this often, however frequently the poll fires. */
const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Watches processed per tick, so a hundred of them cannot stampede the site. */
const MAX_PER_TICK = 3;
/** Announcements per check, so a first run cannot flood a channel. */
const MAX_ANNOUNCEMENTS = 3;
/** Ids remembered per watch; enough to outlast anything still on page one. */
const MAX_SEEN = 120;

export const MAX_WATCHES_PER_USER = 10;

function parseSeen(raw: string): string[] {
  return raw.split(',').filter(Boolean);
}

function serialiseSeen(ids: string[]): string {
  return ids.slice(-MAX_SEEN).join(',');
}

export interface WatchCriteria {
  query: string;
  category?: string | null;
  resolution?: string | null;
  minSeeders?: number;
}

/** Results a watch would announce, across every index that can answer. */
export async function matchesForWatch(criteria: WatchCriteria) {
  const outcome = await searchSources({
    query: criteria.query,
    category: criteria.category ?? undefined,
    // A release a watch is waiting for is new, so it has no seeders yet.
    sort: 'recent',
    limit: 25,
  });

  return outcome.results.filter((result) => {
    if ((result.seeders ?? 0) < (criteria.minSeeders ?? 0)) return false;
    if (!criteria.resolution) return true;
    return parseReleaseName(result.title).resolution === criteria.resolution;
  });
}

export function startTorrentWatchScheduler(client: Client) {
  setInterval(() => void runDue(client), POLL_INTERVAL_MS);
  // Not immediately on boot: let the gateway settle first.
  setTimeout(() => void runDue(client), 60_000);
  logger.info('Torrent watch scheduler started');
}

async function runDue(client: Client) {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - CHECK_EVERY_MS);

  let due;
  try {
    due = await prisma.torrentWatch.findMany({
      where: {
        active: true,
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: cutoff } }],
      },
      orderBy: { lastCheckedAt: 'asc' },
      take: MAX_PER_TICK,
    });
  } catch (err) {
    logger.warn({ err }, 'Could not load torrent watches');
    return;
  }

  for (const watch of due) {
    // Stamped before the search runs: a failing watch must not be retried on
    // every tick, which would hammer the site for as long as it stays broken.
    await prisma.torrentWatch
      .update({ where: { id: watch.id }, data: { lastCheckedAt: new Date() } })
      .catch(() => {});

    try {
      await checkWatch(client, watch);
    } catch (err) {
      if (err instanceof Torrent1337xError) {
        logger.debug({ err, watch: watch.id }, 'Torrent watch could not search');
      } else {
        logger.warn({ err, watch: watch.id }, 'Torrent watch failed');
      }
    }
  }
}

interface WatchRow {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  query: string;
  category: string | null;
  resolution: string | null;
  minSeeders: number;
  seenIds: string;
  lastCheckedAt: Date | null;
}

async function checkWatch(client: Client, watch: WatchRow) {
  const prisma = getPrisma();
  const matches = await matchesForWatch(watch);

  const seen = new Set(parseSeen(watch.seenIds));
  // Ids only mean anything within their own index, so identity is both.
  const key = (result: { source: string; id: string }) => `${result.source}:${result.id}`;
  const fresh = matches.filter((result) => !seen.has(key(result)));

  // First run: record what already exists rather than announcing the entire
  // back catalogue as though it just appeared.
  const firstRun = watch.lastCheckedAt === null && seen.size === 0;

  const remembered = serialiseSeen([...seen, ...matches.map(key)]);
  await prisma.torrentWatch.update({ where: { id: watch.id }, data: { seenIds: remembered } });

  if (firstRun || fresh.length === 0) return;

  for (const result of fresh.slice(0, MAX_ANNOUNCEMENTS)) {
    const release = parseReleaseName(result.title);
    const quality = [episodeLabel(release), qualityLabel(release)].filter(Boolean).join(' · ');

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setAuthor({ name: `New release for "${watch.query}"` })
      .setTitle(result.title.slice(0, 250))
      .setURL(result.pageUrl)
      .setFooter({ text: 'Open it with /torrent scrape for the magnet' })
      .setTimestamp();

    embed.addFields(
      { name: 'Seeders', value: String(result.seeders ?? 0), inline: true },
      { name: 'Quality', value: quality || '—', inline: true },
      { name: 'Source', value: result.source, inline: true },
    );

    await deliver(client, watch, embed);
  }

  logger.info(
    { watch: watch.id, query: watch.query, announced: Math.min(fresh.length, MAX_ANNOUNCEMENTS) },
    'Torrent watch announced new releases',
  );
}

/** Posts to the channel the watch was set in, falling back to a DM. */
async function deliver(client: Client, watch: WatchRow, embed: EmbedBuilder) {
  const mention = `<@${watch.userId}>`;

  if (watch.channelId) {
    try {
      const channel = await client.channels.fetch(watch.channelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send({ content: mention, embeds: [embed] });
        return;
      }
    } catch (err) {
      logger.debug({ err, watch: watch.id }, 'Watch channel unavailable, trying a DM');
    }
  }

  try {
    const user = await client.users.fetch(watch.userId);
    await user.send({ embeds: [embed] });
  } catch (err) {
    logger.debug({ err, watch: watch.id }, 'Could not deliver watch announcement');
  }
}
