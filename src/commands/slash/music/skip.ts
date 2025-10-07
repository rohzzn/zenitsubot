import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const skip = {
  data: { name: 'skip' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const player = shoukaku?.players.get(interaction.guildId!);
    if (!player) { await interaction.reply({ content: 'Not playing.', ephemeral: true }); return; }
    await player.stopTrack();
    await interaction.reply({ content: 'Skipped.', ephemeral: true });
  },
};


