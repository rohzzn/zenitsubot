import type { Client, ChatInputCommandInteraction } from 'discord.js';

export const remove = {
  data: { name: 'remove' },
  category: 'music',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const position = interaction.options.getInteger('position', true);
    const queue = client.playerManager.getQueue(interaction.guildId!);

    if (!queue || queue.list().length === 0) {
      await interaction.reply({ content: 'The queue is empty.', ephemeral: true });
      return;
    }

    // Positions are 1-based in /queue, the array is 0-based.
    const removed = queue.remove(position - 1);

    if (!removed) {
      await interaction.reply({
        content: `There is no track at position ${position}. The queue has ${queue.list().length} track(s).`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: `Removed **${removed.title}** from the queue.` });
  },
};
