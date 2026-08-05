import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';

export const kick = {
  data: { name: 'kick' },
  category: 'mod',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!member) {
      await interaction.reply({ content: 'User not found in this server.', ephemeral: true });
      return;
    }

    if (!member.kickable) {
      await interaction.reply({
        content: 'I cannot kick that member — their role is above mine, or they own the server.',
        ephemeral: true,
      });
      return;
    }

    await member.kick(reason);
    await interaction.reply({ content: `Kicked ${member.user.tag}. Reason: ${reason}` });
  },
};
