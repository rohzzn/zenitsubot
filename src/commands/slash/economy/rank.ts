import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const rank = {
  data: {
    name: 'rank',
    description: 'View your rank card',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const prisma = getPrisma();

    await interaction.deferReply();

    let userEcon = await prisma.userEconomy.findUnique({
      where: { userId: targetUser.id },
    });

    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: { userId: targetUser.id, coins: 1000 },
      });
    }

    // Get rank
    const allUsers = await prisma.userEconomy.findMany({
      orderBy: [{ level: 'desc' }, { xp: 'desc' }],
    });
    const rank = allUsers.findIndex((u) => u.userId === targetUser.id) + 1;

    const xpNeeded = userEcon.level * 100;
    const progress = Math.floor((userEcon.xp / xpNeeded) * 20);
    const progressBar = '█'.repeat(progress) + '░'.repeat(20 - progress);

    // Calculate stats
    const winRate =
      userEcon.gamesPlayed > 0
        ? Math.round((userEcon.totalWon / Math.max(userEcon.totalWagered, 1)) * 100)
        : 0;
    const profit = userEcon.totalWon - userEcon.totalWagered;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setAuthor({
        name: targetUser.username,
        iconURL: targetUser.displayAvatarURL(),
      })
      .setTitle(`Rank #${rank}`)
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: 'Level',
          value: `**${userEcon.level}**`,
          inline: true,
        },
        {
          name: 'Coins',
          value: `${userEcon.coins.toLocaleString()}`,
          inline: true,
        },
        {
          name: 'Rank',
          value: `#${rank} / ${allUsers.length}`,
          inline: true,
        },
        {
          name: 'Progress',
          value: `${progressBar}\n${userEcon.xp} / ${xpNeeded} XP`,
          inline: false,
        },
        {
          name: 'Gambling Stats',
          value:
            `Games: **${userEcon.gamesPlayed}**\n` +
            `Wagered: **${userEcon.totalWagered.toLocaleString()}**\n` +
            `Profit: **${profit >= 0 ? '+' : ''}${profit.toLocaleString()}**`,
          inline: true,
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: true,
        },
      ])
      .setFooter({ text: 'Keep leveling up!' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
