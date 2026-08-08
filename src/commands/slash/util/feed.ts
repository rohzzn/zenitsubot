import type { Client, ChatInputCommandInteraction } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SectionBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  card,
  paragraph,
  divider,
  gap,
  caption,
  facts,
  withThumbnail,
  v2,
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { UserError } from '../../../utils/errors.js';
import { getPrisma } from '../../../services/db.js';
import { discoverFeeds, fetchFeed, type Candidate } from '../../../services/feeds.js';
import { digestBlocks } from '../../../services/feedDelivery.js';
import {
  pendingFor,
  markDelivered,
  pollSource,
  seedSubscription,
} from '../../../services/feedScheduler.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../../listeners/componentRouter.js';

const KIND = 'feed';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SUBSCRIPTIONS = 25;

const MODES: Record<string, { label: string; blurb: string }> = {
  digest: { label: 'Daily digest', blurb: 'One DM a day with everything new' },
  instant: { label: 'As it happens', blurb: 'A DM within half an hour of each post' },
  manual: { label: 'On demand', blurb: 'Nothing is sent; read it with /feed read' },
};

interface FeedState {
  view: 'list' | 'manage' | 'choose';
  subscriptionId?: string;
  /** Feeds found by /feed add, waiting for one to be picked. */
  candidates?: Candidate[];
}

// ---------------------------------------------------------------- rendering

async function subscriptionsFor(userId: string) {
  return getPrisma().feedSubscription.findMany({
    where: { userId },
    include: { source: true },
    orderBy: { createdAt: 'asc' },
  });
}

type Subscription = Awaited<ReturnType<typeof subscriptionsFor>>[number];

function name(subscription: Subscription): string {
  return subscription.label ?? subscription.source.title;
}

/** One line of status, so the list says what each feed is doing without a click. */
function statusLine(subscription: Subscription): string {
  if (subscription.source.disabledAt) return 'Stopped — this feed kept failing';
  if (subscription.paused) return subscription.pauseNote ?? 'Paused';

  const mode = MODES[subscription.mode]?.label ?? subscription.mode;
  const filters = [
    subscription.include ? `only ${subscription.include}` : null,
    subscription.exclude ? `never ${subscription.exclude}` : null,
  ].filter(Boolean);

  return [mode, ...filters].join(' · ');
}

async function listView(userId: string): Promise<Block[]> {
  const subscriptions = await subscriptionsFor(userId);

  if (subscriptions.length === 0) {
    return [
      card().addTextDisplayComponents(
        paragraph(
          '## Your feeds\nYou are not following anything yet.\n\n' +
            'Add one with `/feed add` — it takes a feed URL, a site’s homepage, or a subreddit like `r/rust`.',
        ),
      ),
    ];
  }

  // Counted in one query rather than per-subscription: this list is the most
  // frequently opened screen and it should not cost N round trips.
  const unread = await getPrisma().feedItem.groupBy({
    by: ['sourceId'],
    where: { sourceId: { in: subscriptions.map((s) => s.sourceId) } },
    _count: { _all: true },
  });
  const totals = new Map(unread.map((row) => [row.sourceId, row._count._all]));

  const container = card().addTextDisplayComponents(
    paragraph(
      `## Your feeds\nFollowing ${subscriptions.length} of ${MAX_SUBSCRIPTIONS}. Pick one below to change or remove it.`,
    ),
  );

  container.addSeparatorComponents(divider());

  for (const [index, subscription] of subscriptions.entries()) {
    if (index > 0) container.addSeparatorComponents(gap());

    const held = totals.get(subscription.sourceId) ?? 0;
    const line =
      `**${index + 1}. ${name(subscription)}**\n` +
      `-# ${statusLine(subscription)}${held ? ` · ${held} recent` : ''}`;

    const header = withThumbnail(line, subscription.source.iconUrl);
    if (header instanceof SectionBuilder) container.addSectionComponents(header);
    else container.addTextDisplayComponents(header);
  }

  const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'open'))
      .setPlaceholder('Manage a feed…')
      .addOptions(
        subscriptions.slice(0, 25).map((subscription, index) => ({
          label: `${index + 1}. ${name(subscription)}`.slice(0, 100),
          description: statusLine(subscription).slice(0, 100),
          value: subscription.id,
        })),
      ),
  );

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'readall'))
      .setLabel('Read everything new')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'refresh'))
      .setLabel('Check now')
      .setStyle(ButtonStyle.Secondary),
  );

  return [container, menu, actions];
}

async function manageView(subscriptionId: string): Promise<Block[]> {
  const subscription = await getPrisma().feedSubscription.findUnique({
    where: { id: subscriptionId },
    include: { source: true },
  });

  if (!subscription) return [card().addTextDisplayComponents(paragraph('That feed is gone.'))];

  const pending = await pendingFor(subscriptionId, 100);

  const container = card(
    subscription.paused || subscription.source.disabledAt
      ? ZENITSU_THEME.ERROR
      : ZENITSU_THEME.PRIMARY,
  );

  const header = withThumbnail(
    `## ${name(subscription)}\n${subscription.source.siteUrl ?? subscription.source.url}`,
    subscription.source.iconUrl,
  );
  if (header instanceof SectionBuilder) container.addSectionComponents(header);
  else container.addTextDisplayComponents(header);

  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(
    paragraph(
      facts([
        ['Delivery', MODES[subscription.mode]?.label ?? subscription.mode],
        [
          'At',
          subscription.mode === 'digest'
            ? `${String(subscription.digestHour).padStart(2, '0')}:00 UTC`
            : '-',
        ],
        ['Unread', String(pending.length)],
        ['Sent so far', String(subscription.deliveredCount)],
        ['Only items with', subscription.include ?? '-'],
        ['Never items with', subscription.exclude ?? '-'],
      ]),
    ),
  );

  if (subscription.source.disabledAt) {
    container.addTextDisplayComponents(
      paragraph(
        `**This feed stopped working.**\n${subscription.source.lastError ?? 'It failed too many times in a row.'}`,
      ),
    );
  } else if (subscription.paused) {
    container.addTextDisplayComponents(paragraph(`**Paused.** ${subscription.pauseNote ?? ''}`));
  }

  const modeMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'mode', subscriptionId))
      .setPlaceholder('How should this be delivered?')
      .addOptions(
        Object.entries(MODES).map(([value, { label, blurb }]) => ({
          label,
          description: blurb,
          value,
          default: value === subscription.mode,
        })),
      ),
  );

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'read', subscriptionId))
      .setLabel(pending.length ? `Read ${pending.length} new` : 'Nothing new')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pending.length === 0),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'toggle', subscriptionId))
      .setLabel(subscription.paused ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'back'))
      .setLabel('All feeds')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'drop', subscriptionId))
      .setLabel('Unfollow')
      .setStyle(ButtonStyle.Danger),
  );

  return [container, modeMenu, actions];
}

/** Preview shown before subscribing, so you can see it is the right feed. */
function previewBlocks(
  candidate: Candidate,
  sample: Awaited<ReturnType<typeof fetchFeed>>,
): Block[] {
  const feed = sample.feed;
  const container = card();

  const header = withThumbnail(
    `## ${feed?.title ?? candidate.title}\n${feed?.siteUrl ?? candidate.url}`,
    feed?.iconUrl,
  );
  if (header instanceof SectionBuilder) container.addSectionComponents(header);
  else container.addTextDisplayComponents(header);

  container.addSeparatorComponents(divider());

  const recent = feed?.items.slice(0, 3) ?? [];
  if (recent.length) {
    container.addTextDisplayComponents(
      paragraph(
        `**Most recent**\n${recent
          .map(
            (item) =>
              `[${item.title.slice(0, 90)}](${item.link})${
                item.publishedAt ? ` -# <t:${Math.floor(item.publishedAt.getTime() / 1000)}:R>` : ''
              }`,
          )
          .join('\n')}`,
      ),
    );
  } else {
    container.addTextDisplayComponents(paragraph('This feed has no items in it right now.'));
  }

  container.addTextDisplayComponents(
    caption('You will only get things posted after you follow it, never the back catalogue.'),
  );

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(componentId(KIND, 'sub'))
      .setLabel('Follow this feed')
      .setStyle(ButtonStyle.Success),
  );

  return [container, actions];
}

function chooseBlocks(candidates: Candidate[]): Block[] {
  const container = card().addTextDisplayComponents(
    paragraph(
      `## ${candidates.length} feeds found\nPick the one you want. They are different views of the same site.`,
    ),
  );

  const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(componentId(KIND, 'pick'))
      .setPlaceholder('Choose a feed…')
      .addOptions(
        candidates.map((candidate, index) => ({
          label: candidate.title.slice(0, 100),
          description: candidate.url.slice(0, 100),
          value: String(index),
        })),
      ),
  );

  return [container, menu];
}

// ------------------------------------------------------------------ actions

async function subscribe(userId: string, candidate: Candidate): Promise<string> {
  const prisma = getPrisma();

  const existingCount = await prisma.feedSubscription.count({ where: { userId } });
  if (existingCount >= MAX_SUBSCRIPTIONS) {
    throw new UserError(
      `You are already following ${MAX_SUBSCRIPTIONS} feeds. Unfollow one first.`,
    );
  }

  const fetched = await fetchFeed(candidate.url);
  const feed = fetched.feed;

  // One row per feed no matter how many people follow it, so it is polled once.
  const source = await prisma.feedSource.upsert({
    where: { url: candidate.url },
    create: {
      url: candidate.url,
      title: feed?.title ?? candidate.title,
      siteUrl: feed?.siteUrl,
      iconUrl: feed?.iconUrl,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
    },
    update: {
      title: feed?.title ?? candidate.title,
      // A feed someone re-follows gets another chance.
      disabledAt: null,
      failureCount: 0,
      lastError: null,
    },
  });

  const existing = await prisma.feedSubscription.findUnique({
    where: { userId_sourceId: { userId, sourceId: source.id } },
  });
  if (existing) throw new UserError(`You already follow **${source.title}**.`);

  const subscription = await prisma.feedSubscription.create({
    data: { userId, sourceId: source.id },
  });

  // Stores what the feed currently holds, then marks all of it as already
  // seen. Order matters: poll first so there is something to seed against,
  // or the next poll delivers the entire front page as "new".
  await pollSource(source.id);
  await seedSubscription(subscription.id);

  return subscription.id;
}

async function readAndMark(subscriptionIds: string[], heading: string): Promise<Block[]> {
  const all = [];
  for (const id of subscriptionIds) {
    const items = await pendingFor(id, 25);
    if (items.length) {
      all.push(...items);
      await markDelivered(
        id,
        items.map((item) => item.id),
      );
    }
  }

  if (all.length === 0) {
    return [
      card().addTextDisplayComponents(
        paragraph('## Nothing new\nEverything in your feeds has already been shown.'),
      ),
    ];
  }

  return digestBlocks(all, heading).slice(0, 6);
}

// ------------------------------------------------------------------- router

const handler: ComponentHandler<FeedState> = {
  kind: KIND,
  ttlMs: WEEK_MS,
  expiredMessage: 'This view has expired. Run `/feed list` again.',

  async handle({ interaction, action, args, state, save }) {
    const userId = interaction.user.id;

    if (action === 'open' && interaction.isStringSelectMenu()) {
      const subscriptionId = interaction.values[0]!;
      await interaction.update(v2Update(await manageView(subscriptionId)));
      await save({ view: 'manage', subscriptionId });
      return;
    }

    if (action === 'back') {
      await interaction.update(v2Update(await listView(userId)));
      await save({ view: 'list' });
      return;
    }

    if (action === 'mode' && interaction.isStringSelectMenu()) {
      const subscriptionId = args[0]!;
      await getPrisma().feedSubscription.update({
        where: { id: subscriptionId },
        data: { mode: interaction.values[0]! },
      });
      await interaction.update(v2Update(await manageView(subscriptionId)));
      return;
    }

    if (action === 'toggle') {
      const subscriptionId = args[0]!;
      const current = await getPrisma().feedSubscription.findUnique({
        where: { id: subscriptionId },
      });
      if (!current) throw new UserError('That feed is gone.');

      await getPrisma().feedSubscription.update({
        where: { id: subscriptionId },
        // Resuming clears the note, so a fixed DM setting stops being reported.
        data: { paused: !current.paused, pauseNote: null },
      });
      await interaction.update(v2Update(await manageView(subscriptionId)));
      return;
    }

    if (action === 'drop') {
      const subscriptionId = args[0]!;
      await getPrisma().feedSubscription.deleteMany({ where: { id: subscriptionId, userId } });
      await interaction.update(v2Update(await listView(userId)));
      await save({ view: 'list' });
      return;
    }

    if (action === 'read') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(v2Update(await readAndMark([args[0]!], 'New for you')));
      return;
    }

    if (action === 'readall') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const subscriptions = await subscriptionsFor(userId);
      await interaction.editReply(
        v2Update(
          await readAndMark(
            subscriptions.map((s) => s.id),
            'New in your feeds',
          ),
        ),
      );
      return;
    }

    if (action === 'refresh') {
      await interaction.deferUpdate();
      const subscriptions = await subscriptionsFor(userId);
      // Bounded: this is a user-triggered poll and must not become a way to
      // hammer a dozen sites on demand.
      for (const subscription of subscriptions.slice(0, 10)) {
        await pollSource(subscription.sourceId);
      }
      await interaction.editReply(v2Update(await listView(userId)));
      return;
    }

    if (action === 'pick' && interaction.isStringSelectMenu()) {
      const candidate = state.candidates?.[Number(interaction.values[0])];
      if (!candidate) throw new UserError('That option is no longer available.');

      await interaction.deferUpdate();
      const sample = await fetchFeed(candidate.url);
      await interaction.editReply(v2Update(previewBlocks(candidate, sample)));
      await save({ view: 'choose', candidates: [candidate] });
      return;
    }

    if (action === 'sub') {
      const candidate = state.candidates?.[0];
      if (!candidate) throw new UserError('That feed is no longer available.');

      await interaction.deferUpdate();
      const subscriptionId = await subscribe(userId, candidate);
      await interaction.editReply(v2Update(await manageView(subscriptionId)));
      await save({ view: 'manage', subscriptionId });
    }
  },
};

registerComponentHandler(handler);

// ------------------------------------------------------------------ command

export const feed = {
  data: { name: 'feed' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (subcommand === 'add') {
      const input = interaction.options.getString('feed', true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const candidates = await discoverFeeds(input);

      // One candidate goes straight to the preview; several need a choice
      // first, because a site's "all posts" and "comments" feeds look alike.
      const blocks =
        candidates.length === 1
          ? previewBlocks(candidates[0]!, await fetchFeed(candidates[0]!.url))
          : chooseBlocks(candidates);

      const message = await interaction.editReply(v2Update(blocks));
      await attachState(message.id, handler, userId, {
        view: 'choose',
        candidates,
      });
      return;
    }

    if (subcommand === 'read') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const subscriptions = await subscriptionsFor(userId);

      if (subscriptions.length === 0) {
        throw new UserError('You are not following any feeds. Add one with `/feed add`.');
      }

      await interaction.editReply(
        v2Update(
          await readAndMark(
            subscriptions.map((s) => s.id),
            'New in your feeds',
          ),
        ),
      );
      return;
    }

    // list
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await interaction.editReply(v2Update(await listView(userId)));
    await attachState(message.id, handler, userId, { view: 'list' });
  },
};
