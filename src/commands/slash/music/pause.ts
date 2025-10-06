import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const pause = {
  data: { name: 'pause' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const player = shoukaku?.players.get(interaction.guildId!);
    if (!player) { await interaction.reply({ content: 'Not playing.', ephemeral: true }); return; }
    await player.setPaused(true);
    await interaction.reply({ content: 'Paused.', ephemeral: true });
  },
};


