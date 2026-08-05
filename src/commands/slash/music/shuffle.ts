import type { Client, ChatInputCommandInteraction } from 'discord.js';

export const shuffle = {
  data: { name: 'shuffle' },
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const pm = client.playerManager;
    const q = pm.getQueue(interaction.guildId!);
    if (!q) {
      await interaction.reply({ content: 'No queue.', ephemeral: true });
      return;
    }
    q.shuffle();
    await interaction.reply({ content: 'Queue shuffled.', ephemeral: true });
  },
};
