import type { Client, ChatInputCommandInteraction } from 'discord.js';

export const loop = {
  data: { name: 'loop' },
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const mode = interaction.options.getString('mode') as 'off' | 'track' | 'queue' | null;
    const pm = client.playerManager;
    const q = pm.getQueue(interaction.guildId!);
    if (!q) {
      await interaction.reply({ content: 'No queue.', ephemeral: true });
      return;
    }
    if (mode) q.loop = mode;
    await interaction.reply({ content: `Loop mode: ${q.loop}`, ephemeral: true });
  },
};
