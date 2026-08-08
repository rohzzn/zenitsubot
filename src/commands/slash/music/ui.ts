import type { ChatInputCommandInteraction, Client, GuildMember } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SectionBuilder } from 'discord.js';
import type { Player } from 'shoukaku';
import { shoukaku } from '../../../music/lavalink.js';
import type { GuildQueue } from '../../../music/queue.js';
import {
  card,
  paragraph,
  divider,
  caption,
  withThumbnail,
  bar,
  clock,
  v2,
  type Block,
} from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { UserError } from '../../../utils/errors.js';

/**
 * Shared shape for the music commands.
 *
 * Every one of them used to answer with a sentence — "Skipped.", "Paused.",
 * "Volume set to 60%." — which tells you the command ran and nothing about
 * what you now have. These build the state instead: after a skip you see what
 * is playing, after a shuffle you see the new order. The confirmation is the
 * screen, not a word.
 */

export interface MusicContext {
  queue: GuildQueue;
  player: Player;
  guildId: string;
}

/**
 * Resolves the live player and queue, or explains which is missing.
 *
 * `requireVoice` is separate because reading the queue is harmless while
 * changing it is not — /queue and /now should work from anywhere, /skip should
 * not work from across the server.
 */
export function requireMusic(
  client: Client,
  interaction: ChatInputCommandInteraction,
): MusicContext {
  const guildId = interaction.guildId;
  if (!guildId) throw new UserError('Music only works in a server.');

  const queue = client.playerManager.getQueue(guildId);
  const player = shoukaku?.players.get(guildId);

  if (!queue || !player) throw new UserError('Nothing is playing right now.');
  return { queue, player, guildId };
}

/** Stops someone changing playback for a channel they are not sitting in. */
export function requireVoice(interaction: ChatInputCommandInteraction): void {
  const member = interaction.member as GuildMember | null;
  const listening = member?.voice.channel?.id;
  const botChannel = shoukaku?.connections.get(interaction.guildId ?? '')?.channelId;

  if (!listening) throw new UserError('Join a voice channel first.');
  if (botChannel && listening !== botChannel) {
    throw new UserError('You are in a different voice channel from the bot.');
  }
}

/** Transport row, shared with the message /play posts. Handled by the music listener. */
export function transport(paused: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pause')
      .setLabel(paused ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_loop').setLabel('Loop').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_stop').setLabel('Stop').setStyle(ButtonStyle.Danger),
  );
}

export interface NowPlayingOptions {
  /** Replaces the title line, for "Skipped to" and the like. */
  heading?: string;
  /** A line under the transport, for what the command just changed. */
  note?: string;
  accent?: number;
  showControls?: boolean;
  showUpNext?: boolean;
}

/**
 * The now-playing card, which is the answer to almost every music command.
 *
 * Deliberately identical everywhere it appears: the same layout after /play,
 * /skip, /pause and /now means one glance tells you the state regardless of
 * how you got there.
 */
export function nowPlaying(context: MusicContext, options: NowPlayingOptions = {}): Block[] {
  const { queue, player } = context;
  const track = queue.now();

  if (!track) {
    return [
      card(options.accent ?? ZENITSU_THEME.PRIMARY).addTextDisplayComponents(
        paragraph(
          `## ${options.heading ?? 'Nothing playing'}\n${options.note ?? 'The queue is empty.'}`,
        ),
      ),
    ];
  }

  const container = card(options.accent ?? ZENITSU_THEME.PRIMARY);

  const heading = withThumbnail(
    `## ${options.heading ?? track.title}\n${options.heading ? track.title : track.author}`,
    track.artworkUrl,
  );
  if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
  else container.addTextDisplayComponents(heading);

  container.addSeparatorComponents(divider());

  // Backticks hold the bar in a monospace run so the characters line up.
  const elapsed = player.position ?? 0;
  container.addTextDisplayComponents(
    paragraph(
      `\`${bar(track.duration ? elapsed / track.duration : 0)}\`\n` +
        `\`${clock(elapsed)} / ${clock(track.duration)}\``,
    ),
  );

  if (options.showUpNext !== false) {
    const upNext = queue.list().slice(queue.position() + 1, queue.position() + 4);
    if (upNext.length) {
      container.addTextDisplayComponents(
        paragraph(`**Up next**\n${upNext.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}`),
      );
    }
  }

  const status = [
    player.paused ? 'Paused' : null,
    queue.loop !== 'off' ? `Loop: ${queue.loop}` : null,
    options.note ?? null,
  ].filter(Boolean);

  if (status.length) container.addTextDisplayComponents(caption(status.join(' · ')));

  const blocks: Block[] = [container];
  if (options.showControls !== false) blocks.push(transport(Boolean(player.paused)));
  return blocks;
}

/** A small card for an action with no now-playing state to show. */
export function notice(title: string, detail?: string, accent?: number): Block[] {
  return [
    card(accent ?? ZENITSU_THEME.PRIMARY).addTextDisplayComponents(
      paragraph(`## ${title}${detail ? `\n${detail}` : ''}`),
    ),
  ];
}

/** Replies with the now-playing card. The default answer for a music command. */
export async function replyNowPlaying(
  interaction: ChatInputCommandInteraction,
  context: MusicContext,
  options: NowPlayingOptions = {},
): Promise<void> {
  await interaction.reply(v2(nowPlaying(context, options)));
}
