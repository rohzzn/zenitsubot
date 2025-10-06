import type { Client, ChatInputCommandInteraction, TextChannel } from 'discord.js';

export const purge = {
  data: { name: 'purge' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const count = interaction.options.getInteger('count') || 10;
    
    if (count < 1 || count > 100) {
      await interaction.reply({ content: 'Count must be between 1-100.', ephemeral: true });
      return;
    }
    
    const channel = interaction.channel as TextChannel;
    await channel.bulkDelete(count, true);
    await interaction.reply({ content: `Deleted ${count} messages.`, ephemeral: true });
  },
};

