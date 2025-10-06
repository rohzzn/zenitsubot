import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const stop = {
  data: { name: 'stop' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const player = shoukaku?.players.get(guildId);
    if (!player) {
      await interaction.reply({ content: 'Not playing.', ephemeral: true });
      return;
    }
    await player.stopTrack();
    await player.destroy();
    await interaction.reply({ content: 'Stopped and left.', ephemeral: true });
  },
};


