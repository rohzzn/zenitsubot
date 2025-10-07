import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';

export const mute = {
  data: { name: 'mute' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getMember('user') as GuildMember | null;
    const duration = interaction.options.getInteger('duration') || 60;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (!member) {
      await interaction.reply({ content: 'User not found.', ephemeral: true });
      return;
    }
    
    await member.timeout(duration * 1000, reason);
    await interaction.reply({ content: `Muted ${member.user.tag} for ${duration}s. Reason: ${reason}` });
  },
};

