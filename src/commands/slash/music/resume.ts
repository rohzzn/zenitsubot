import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const resume = {
  data: { name: 'resume' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const player = shoukaku?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: 'Not playing.', ephemeral: true });
      return;
    }
    await player.setPaused(false);
    await interaction.reply({ content: 'Resumed.', ephemeral: true });
  },
};
