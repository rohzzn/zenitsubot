import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SectionBuilder } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';
import { card, withThumbnail, paragraph, divider, bar, clock, v2 } from '../../../utils/layout.js';
import { UserError } from '../../../utils/errors.js';

/**
 * Transport controls, shared with the message /play posts.
 *
 * These ids are handled by the music button listener rather than the component
 * router: the state they act on is the live player, which belongs to the voice
 * connection and not to any particular message.
 */
function transport(paused: boolean): ActionRowBuilder<ButtonBuilder> {
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

export const now = {
  data: { name: 'now' },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const queue = client.playerManager.getQueue(interaction.guildId!);
    const track = queue?.now();

    if (!track || !queue) throw new UserError('Nothing is playing.');

    const player = shoukaku?.players.get(interaction.guildId!);
    const elapsed = player?.position ?? 0;

    const heading = withThumbnail(
      `## ${track.title}\n${track.author}`,
      // Lavalink hands back a thumbnail for most sources; withThumbnail drops
      // it silently when it is not something Discord will render.
      track.artworkUrl,
    );

    const container = card();
    if (heading instanceof SectionBuilder) container.addSectionComponents(heading);
    else container.addTextDisplayComponents(heading);

    container.addSeparatorComponents(divider());

    // Backticks keep the bar in a monospace run so the characters line up.
    container.addTextDisplayComponents(
      paragraph(
        `\`${bar(track.duration ? elapsed / track.duration : 0)}\`\n` +
          `\`${clock(elapsed)} / ${clock(track.duration)}\``,
      ),
    );

    const upNext = queue.list().slice(queue.position() + 1, queue.position() + 4);
    if (upNext.length) {
      container.addTextDisplayComponents(
        paragraph(
          `**Up next**\n${upNext.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}` +
            (queue.loop !== 'off' ? `\n\nLoop: ${queue.loop}` : ''),
        ),
      );
    } else if (queue.loop !== 'off') {
      container.addTextDisplayComponents(paragraph(`Loop: ${queue.loop}`));
    }

    await interaction.reply(v2([container, transport(player?.paused ?? false)]));
  },
};
