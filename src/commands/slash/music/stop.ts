import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const stop = {
  data: { name: 'stop' },
  category: 'music',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const player = shoukaku?.players.get(guildId);

    if (!player) {
      await interaction.reply({ content: 'Not playing.', ephemeral: true });
      return;
    }

    await player.stopTrack();
    // destroy() only tears down the Lavalink player; leaving voice is separate.
    await client.playerManager.destroy(guildId);
    await interaction.reply({ content: 'Stopped playback, cleared the queue and left the channel.' });
  },
};
