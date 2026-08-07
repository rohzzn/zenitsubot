import type { Client, ChatInputCommandInteraction } from 'discord.js';
import {
  card,
  paragraph,
  divider,
  caption,
  clock,
  v2,
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { UserError } from '../../../utils/errors.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../../listeners/componentRouter.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const KIND = 'queue';
const PER_PAGE = 10;
const HOUR_MS = 60 * 60 * 1000;

interface Row {
  title: string;
  author: string;
  duration: number;
  current: boolean;
}

interface QueueState {
  rows: Row[];
  page: number;
  loop: string;
}

function render(state: QueueState) {
  const pages = Math.max(1, Math.ceil(state.rows.length / PER_PAGE));
  const page = Math.min(Math.max(state.page, 0), pages - 1);
  const slice = state.rows.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  const remaining = state.rows.reduce((sum, row) => sum + row.duration, 0);

  const container = card()
    .addTextDisplayComponents(
      paragraph(
        `## Queue\n${state.rows.length} ${state.rows.length === 1 ? 'track' : 'tracks'} · ${clock(remaining)} total`,
      ),
    )
    .addSeparatorComponents(divider());

  // The playing track is marked rather than removed, so the numbering still
  // matches what /remove expects.
  const lines = slice.map((row, i) => {
    const index = page * PER_PAGE + i + 1;
    const label = `${String(index).padStart(2)}. ${row.title} — ${row.author}`;
    return row.current
      ? `**${label}** \`${clock(row.duration)}\` ◀ playing`
      : `${label} \`${clock(row.duration)}\``;
  });

  container.addTextDisplayComponents(paragraph(lines.join('\n')));

  if (pages > 1) container.addTextDisplayComponents(caption(`Page ${page + 1} of ${pages}`));
  if (state.loop !== 'off') container.addTextDisplayComponents(caption(`Loop: ${state.loop}`));

  const blocks: Block[] = [container];

  if (pages > 1) {
    blocks.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(componentId(KIND, 'go', Math.max(0, page - 1)))
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(componentId(KIND, 'go', Math.min(pages - 1, page + 1)))
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= pages - 1),
      ),
    );
  }

  return blocks;
}

/**
 * Shared, unlike most controls: a queue is something everyone in the channel
 * is looking at, so anyone may page through it.
 */
const handler: ComponentHandler<QueueState> = {
  kind: KIND,
  ttlMs: HOUR_MS,
  expiredMessage: 'This queue view is stale. Run `/queue` again.',
  shared: true,
  async handle({ interaction, args, state, save }) {
    const next = { ...state, page: Number(args[0] ?? 0) };
    await interaction.update(v2Update(render(next)));
    await save(next);
  },
};

registerComponentHandler(handler);

export const queue = {
  data: { name: 'queue' },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildQueue = client.playerManager.getQueue(interaction.guildId!);
    const tracks = guildQueue?.list() ?? [];

    if (!guildQueue || tracks.length === 0) throw new UserError('The queue is empty.');

    const playing = guildQueue.position();
    const state: QueueState = {
      rows: tracks.map((track, index) => ({
        title: track.title.slice(0, 80),
        author: track.author.slice(0, 40),
        duration: track.duration,
        current: index === playing,
      })),
      // Opening on the playing track beats opening on page one of a long queue.
      page: Math.max(0, Math.floor(playing / PER_PAGE)),
      loop: guildQueue.loop,
    };

    const response = await interaction.reply({ ...v2(render(state)), withResponse: true });
    const message = response.resource?.message;

    if (message && state.rows.length > PER_PAGE) {
      await attachState(message.id, handler, interaction.user.id, state);
    }
  },
};
