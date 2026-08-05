import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const daily = {
  data: {
    name: 'daily',
    description: 'Claim your daily coins (global across all servers)!',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const prisma = getPrisma();
    const userId = interaction.user.id;

    let userEcon = await prisma.userEconomy.findUnique({
      where: { userId },
    });

    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: { userId, coins: 1000 },
      });
    }

    const now = new Date();
    const lastDaily = userEcon.lastDaily;

    if (lastDaily) {
      const timeSince = now.getTime() - lastDaily.getTime();
      const hoursLeft = 24 - Math.floor(timeSince / (1000 * 60 * 60));
      const minutesLeft = Math.ceil((24 * 60 * 60 * 1000 - timeSince) / (1000 * 60));

      if (timeSince < 24 * 60 * 60 * 1000) {
        await interaction.reply({
          content: `W-wait! You already claimed your daily! Come back in **${hoursLeft}h ${minutesLeft % 60}m**!`,
          ephemeral: true,
        });
        return;
      }
    }

    // Streak bonus
    let streak = 1;
    if (lastDaily) {
      const daysSince = Math.floor((now.getTime() - lastDaily.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince === 1) {
        // Continuing streak
        streak = Math.floor(userEcon.xp / 10) + 1; // Use XP as streak tracker (temp)
      }
    }

    const baseDaily = 500;
    const randomBonus = Math.floor(Math.random() * 200) + 100; // 100-300
    const streakBonus = Math.min(streak * 50, 500); // Max 500 bonus
    const total = baseDaily + randomBonus + streakBonus;

    await prisma.userEconomy.update({
      where: { userId },
      data: {
        coins: userEcon.coins + total,
        lastDaily: now,
        xp: userEcon.xp + 10, // Track daily streaks
      },
    });

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.SUCCESS)
      .setTitle(`Daily Reward Claimed!`)
      .setDescription(`You received **${total.toLocaleString()}** coins!\n\u200b`)
      .addFields([
        {
          name: 'Breakdown',
          value:
            `Base Daily: **${baseDaily}**\n` +
            `Random Bonus: **+${randomBonus}**\n` +
            (streakBonus > 0 ? `Streak Bonus: **+${streakBonus}**\n` : '') +
            `\u200b`,
          inline: false,
        },
        {
          name: 'New Balance',
          value: `**${(userEcon.coins + total).toLocaleString()}** coins`,
          inline: true,
        },
        {
          name: 'Next Daily',
          value: `**24 hours**`,
          inline: true,
        },
      ])
      .setFooter({ text: 'Come back tomorrow for more! Global across all servers' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
