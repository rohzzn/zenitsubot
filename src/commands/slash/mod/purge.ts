import type { Client, ChatInputCommandInteraction, TextChannel } from 'discord.js';

export const purge = {
  data: { name: 'purge' },
  category: 'mod',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const amount = interaction.options.getInteger('amount', true);

    const channel = interaction.channel as TextChannel;
    const deleted = await channel.bulkDelete(amount, true);
    await interaction.reply({
      content: `Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'}.`,
      ephemeral: true,
    });
  },
};
