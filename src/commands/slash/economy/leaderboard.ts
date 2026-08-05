import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const leaderboard = {
  data: {
    name: 'leaderboard',
    description: 'View global leaderboard for coins or levels',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const type = interaction.options.getString('type') || 'coins';
    const prisma = getPrisma();

    await interaction.deferReply();

    const orderBy =
      type === 'coins'
        ? { coins: 'desc' as const }
        : { level: 'desc' as const, xp: 'desc' as const };

    const topUsers = await prisma.userEconomy.findMany({
      orderBy,
      take: 15,
    });

    if (topUsers.length === 0) {
      await interaction.editReply({ content: `No economy data yet! Start using commands!` });
      return;
    }

    // Find current user's rank
    const allUsers = await prisma.userEconomy.findMany({ orderBy });
    const userRank = allUsers.findIndex((u) => u.userId === interaction.user.id) + 1;
    const currentUser = allUsers.find((u) => u.userId === interaction.user.id);

    const description = await Promise.all(
      topUsers.map(async (user, index) => {
        try {
          const discordUser = await client.users.fetch(user.userId).catch(() => null);
          const username = discordUser?.username || 'Unknown User';
          const medal =
            index === 0
              ? ''
              : index === 1
                ? ''
                : index === 2
                  ? ''
                  : `\`${(index + 1).toString().padStart(2, '0')}.\``;

          const isCurrentUser = user.userId === interaction.user.id;
          const prefix = isCurrentUser ? '**' : '';
          const suffix = isCurrentUser ? '**' : '';

          if (type === 'coins') {
            return `${medal} ${prefix}${username}${suffix} - ${user.coins.toLocaleString()}`;
          } else {
            return `${medal} ${prefix}${username}${suffix} - Level ${user.level} (${user.xp} XP)`;
          }
        } catch (err) {
          return `${index + 1}. Unknown User`;
        }
      }),
    );

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`Global ${type === 'coins' ? 'Wealth' : 'Level'} Leaderboard`)
      .setDescription(
        `**Top ${topUsers.length} Users Worldwide**\n` +
          `*Stats are global across all servers*\n\n` +
          `${description.join('\n\n')}\n\u200b`,
      );

    if (userRank > 0 && userRank > 15 && currentUser) {
      embed.addFields([
        {
          name: 'Your Rank',
          value:
            `**#${userRank}** out of ${allUsers.length} users\n` +
            (type === 'coins'
              ? `${currentUser.coins.toLocaleString()} coins`
              : `Level ${currentUser.level} (${currentUser.xp} XP)`),
          inline: false,
        },
      ]);
    }

    embed.setFooter({ text: 'Keep climbing!' });
    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
