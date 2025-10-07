import type { Client, ChatInputCommandInteraction, GuildMember, PermissionsBitField } from 'discord.js';

export const kick = {
  data: { name: 'kick' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (!member) {
      await interaction.reply({ content: 'User not found.', ephemeral: true });
      return;
    }
    
    await member.kick(reason);
    await interaction.reply({ content: `Kicked ${member.user.tag}. Reason: ${reason}` });
  },
};

