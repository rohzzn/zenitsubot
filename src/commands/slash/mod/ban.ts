import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';

export const ban = {
  data: { name: 'ban' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (!member) {
      await interaction.reply({ content: 'User not found.', ephemeral: true });
      return;
    }
    
    await member.ban({ reason });
    await interaction.reply({ content: `Banned ${member.user.tag}. Reason: ${reason}` });
  },
};

