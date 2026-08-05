import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { ChannelType, EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

export const server = {
  data: { name: 'server' },
  category: 'util',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild!;
    const channels = guild.channels.cache;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(guild.name)
      .addFields(
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        {
          name: 'Created',
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
          inline: true,
        },
        {
          name: 'Channels',
          value: `${channels.filter((c) => c.type === ChannelType.GuildText).size} text • ${
            channels.filter((c) => c.type === ChannelType.GuildVoice).size
          } voice`,
          inline: true,
        },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Boosts', value: `${guild.premiumSubscriptionCount ?? 0}`, inline: true },
      )
      .setTimestamp();

    // iconURL() is null for icon-less guilds; setThumbnail rejects empty strings.
    const icon = guild.iconURL({ size: 256 });
    if (icon) embed.setThumbnail(icon);

    await interaction.reply({ embeds: [embed] });
  },
};
