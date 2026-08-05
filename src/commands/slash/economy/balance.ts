import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const balance = {
  data: {
    name: 'balance',
    description: "Check your or someone else's balance and level (global across all servers)",
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const prisma = getPrisma();

    let userEcon = await prisma.userEconomy.findUnique({
      where: { userId: targetUser.id },
    });

    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: {
          userId: targetUser.id,
          coins: 1000,
        },
      });
    }

    const xpNeeded = userEcon.level * 100;
    const progress = Math.floor((userEcon.xp / xpNeeded) * 20);
    const progressBar = '█'.repeat(progress) + '░'.repeat(20 - progress);

    // Calculate win rate
    const winRate =
      userEcon.gamesPlayed > 0 ? Math.round((userEcon.totalWon / userEcon.totalWagered) * 100) : 0;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setAuthor({
        name: targetUser.username,
        iconURL: targetUser.displayAvatarURL(),
      })
      .setTitle('Profile')
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .addFields([
        {
          name: 'Coins',
          value: `${userEcon.coins.toLocaleString()}`,
          inline: true,
        },
        {
          name: 'Level',
          value: `${userEcon.level}`,
          inline: true,
        },
        {
          name: 'XP',
          value: `${userEcon.xp}/${xpNeeded}`,
          inline: true,
        },
        {
          name: 'Progress',
          value: progressBar,
          inline: false,
        },
        {
          name: 'Gambling',
          value:
            `Games: **${userEcon.gamesPlayed}**\n` +
            `Wagered: **${userEcon.totalWagered.toLocaleString()}**\n` +
            `Profit: **${userEcon.totalWon - userEcon.totalWagered >= 0 ? '+' : ''}${(userEcon.totalWon - userEcon.totalWagered).toLocaleString()}**`,
          inline: false,
        },
      ])
      .setFooter({ text: 'Global Economy' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
