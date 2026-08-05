import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const leave = {
  data: { name: 'leave' },
  category: 'music',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    if (!shoukaku?.players.get(guildId)) {
      await interaction.reply({ content: "I'm not in a voice channel.", ephemeral: true });
      return;
    }

    await client.playerManager.destroy(guildId);
    await interaction.reply({ content: 'Left the voice channel.' });
  },
};
