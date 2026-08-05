import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { getPrisma } from '../services/db.js';
import { logger } from '../services/logger.js';
import { ZENITSU_THEME } from '../utils/constants.js';
import { DEFAULT_GOODBYE, renderTemplate } from '../commands/slash/admin/goodbye.js';

export function registerGuildMemberRemoveListener(client: Client) {
  client.on('guildMemberRemove', async (member) => {
    try {
      const config = await getPrisma().guildConfig.findUnique({
        where: { guildId: member.guild.id },
        select: { goodbyeEnabled: true, goodbyeChannelId: true, goodbyeMessage: true },
      });

      if (!config?.goodbyeEnabled || !config.goodbyeChannelId) return;

      const channel = (await client.channels
        .fetch(config.goodbyeChannelId)
        .catch(() => null)) as TextChannel | null;

      if (!channel?.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setDescription(
          renderTemplate(config.goodbyeMessage || DEFAULT_GOODBYE, {
            // The member has already left, so a mention would not resolve.
            user: member.user.username,
            server: member.guild.name,
            memberCount: member.guild.memberCount,
          }),
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.warn({ err, guild: member.guild.id }, 'Goodbye message failed');
    }
  });
}
