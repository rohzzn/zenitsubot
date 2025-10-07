import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const volume = {
  data: { name: 'volume' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const level = interaction.options.getInteger('level') || 50;
    if (level < 0 || level > 100) {
      await interaction.reply({ content: 'Volume must be 0-100.', ephemeral: true });
      return;
    }
    const player = shoukaku?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: 'Not playing.', ephemeral: true });
      return;
    }
    await player.setGlobalVolume(level);
    await interaction.reply({ content: `Volume set to ${level}%.`, ephemeral: true });
  },
};

