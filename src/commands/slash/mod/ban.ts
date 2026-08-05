import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { writeModLog } from '../../../services/modLog.js';

export const ban = {
  data: { name: 'ban' },
  category: 'moderation',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!member) {
      await interaction.reply({ content: 'User not found in this server.', ephemeral: true });
      return;
    }

    if (!member.bannable) {
      await interaction.reply({
        content: 'I cannot ban that member — their role is above mine, or they own the server.',
        ephemeral: true,
      });
      return;
    }

    const { user } = member;
    await member.ban({ reason });
    await interaction.reply({ content: `Banned ${user.tag}. Reason: ${reason}` });

    await writeModLog(client, {
      guildId: interaction.guildId!,
      action: 'Ban',
      target: user,
      moderator: interaction.user,
      reason,
    });
  },
};
