import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder as EB } from 'discord.js';

export const queue = {
  data: { name: 'queue' },
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const pm = client.playerManager;
    const q = pm.getQueue(interaction.guildId!);
    if (!q || q.list().length === 0) {
      await interaction.reply({ content: 'Queue is empty.', ephemeral: true });
      return;
    }
    const tracks = q.list().slice(0, 10);
    const embed = new EB()
      .setTitle('Queue')
      .setDescription(tracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n'));
    await interaction.reply({ embeds: [embed] });
  },
};

