import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

export const user = {
  data: { name: 'user' },
  category: 'util',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member =
      (interaction.options.getMember('target') as GuildMember | null) ??
      (interaction.member as GuildMember);

    const roles = member.roles.cache
      .filter((role) => role.id !== interaction.guildId)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.toString());

    const embed = new EmbedBuilder()
      .setColor(member.displayColor || ZENITSU_THEME.PRIMARY)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: member.id, inline: true },
        { name: 'Nickname', value: member.nickname ?? 'None', inline: true },
        { name: 'Bot', value: member.user.bot ? 'Yes' : 'No', inline: true },
        {
          name: 'Joined Server',
          value: member.joinedTimestamp
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
            : 'Unknown',
          inline: true,
        },
        {
          name: 'Account Created',
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`,
          inline: true,
        },
        {
          name: `Roles (${roles.length})`,
          value: roles.length ? roles.slice(0, 15).join(' ') : 'None',
          inline: false,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
