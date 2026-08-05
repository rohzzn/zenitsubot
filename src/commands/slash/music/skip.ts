import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const skip = {
  data: { name: 'skip' },
  category: 'music',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const player = shoukaku?.players.get(guildId);

    if (!player) {
      await interaction.reply({ content: 'Not playing.', ephemeral: true });
      return;
    }

    // Advance explicitly rather than relying on stopTrack — a stop-triggered
    // 'end' event is deliberately ignored, so it would just halt playback.
    const advanced = await client.playerManager.advance(guildId);

    if (advanced) {
      const track = client.playerManager.getQueue(guildId)?.now();
      await interaction.reply({
        content: `Skipped. Now playing: **${track?.title ?? 'next track'}**`,
      });
      return;
    }

    await player.stopTrack();
    await interaction.reply({ content: 'Skipped. The queue is now empty.', ephemeral: true });
  },
};
