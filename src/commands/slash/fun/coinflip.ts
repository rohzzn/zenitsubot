import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const coinflip = {
  data: {
    name: 'coinflip',
    description: 'Flip a coin - double or nothing!',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const bet = interaction.options.getInteger('bet', true);
    const choice = interaction.options.getString('choice', true); // 'heads' or 'tails'

    if (bet < 10) {
      await interaction.reply({
        content: `Minimum bet is 10 coins!`,
        ephemeral: true,
      });
      return;
    }

    if (bet > 50000) {
      await interaction.reply({
        content: `Maximum bet is 50,000 coins!`,
        ephemeral: true,
      });
      return;
    }

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

    if (userEcon.coins < bet) {
      await interaction.reply({
        content: `W-wait! You only have ${userEcon.coins.toLocaleString()} coins!`,
        ephemeral: true,
      });
      return;
    }

    // Flip the coin
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === choice;
    const profit = won ? bet : -bet;
    const newBalance = userEcon.coins + profit;

    // Update database
    await prisma.userEconomy.update({
      where: { userId },
      data: {
        coins: newBalance,
        totalWagered: userEcon.totalWagered + bet,
        totalWon: userEcon.totalWon + (won ? bet * 2 : 0),
        gamesPlayed: userEcon.gamesPlayed + 1,
      },
    });

    const coinEmoji = result === 'heads' ? '' : '';

    const embed = new EmbedBuilder()
      .setColor(won ? ZENITSU_THEME.SUCCESS : ZENITSU_THEME.ERROR)
      .setTitle(`Coinflip`)
      .setDescription(
        `**Bet:** ${bet.toLocaleString()}\n` +
          `**Your Choice:** ${choice === 'heads' ? 'Heads' : 'Tails'}\n\u200b`,
      )
      .addFields([
        {
          name: 'The Coin Lands On...',
          value: `# ${coinEmoji} ${result.toUpperCase()}!\n\u200b`,
          inline: false,
        },
      ]);

    if (won) {
      embed.addFields([
        {
          name: `YOU WON!`,
          value:
            `**Congratulations!** You guessed correctly!\n\n` +
            `**Won:** +${bet.toLocaleString()}\n` +
            `**Payout:** ${(bet * 2).toLocaleString()}\n\u200b`,
          inline: false,
        },
      ]);
    } else {
      embed.addFields([
        {
          name: `You Lost...`,
          value: `Better luck next time!\n\n` + `**Lost:** -${bet.toLocaleString()}\n\u200b`,
          inline: false,
        },
      ]);
    }

    embed.addFields([
      {
        name: 'New Balance',
        value: `**${newBalance.toLocaleString()}** coins`,
        inline: true,
      },
      {
        name: 'This Flip',
        value: won ? `+${profit.toLocaleString()}` : `${profit.toLocaleString()}`,
        inline: true,
      },
    ]);

    embed.setFooter({ text: '50/50 chance - Good luck!' });
    embed.setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
