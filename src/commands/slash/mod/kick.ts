import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { writeModLog } from '../../../services/modLog.js';

export const kick = {
  data: { name: 'kick' },
  category: 'moderation',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
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

    const { user } = member;
    await member.kick(reason);
    await interaction.reply({ content: `Kicked ${user.tag}. Reason: ${reason}` });

    await writeModLog(client, {
      guildId: interaction.guildId!,
      action: 'Kick',
      target: user,
      moderator: interaction.user,
      reason,
    });
  },
};
