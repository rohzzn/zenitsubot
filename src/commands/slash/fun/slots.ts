import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

// Text reel symbols, padded to a common width so the reel display stays aligned.
const symbols = ['CHERRY', 'LEMON', 'PLUM', 'BELL', 'STAR', 'GEM', 'SEVEN'] as const;

const payouts: Record<(typeof symbols)[number], number> = {
  CHERRY: 2,
  LEMON: 3,
  PLUM: 4,
  BELL: 5,
  STAR: 10,
  GEM: 20,
  SEVEN: 50,
};

const REEL_WIDTH = Math.max(...symbols.map((s) => s.length));

function pad(symbol: string): string {
  const total = REEL_WIDTH - symbol.length;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + symbol + ' '.repeat(total - left);
}

export const slots = {
  data: {
    name: 'slots',
    description: 'Play the slot machine!',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const bet = interaction.options.getInteger('bet', true);

    if (bet < 10) {
      await interaction.reply({
        content: `Minimum bet is 10 coins!`,
        ephemeral: true,
      });
      return;
    }

    if (bet > 5000) {
      await interaction.reply({
        content: `Maximum bet is 5,000 coins!`,
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
        content: `You only have ${userEcon.coins.toLocaleString()} coins!`,
        ephemeral: true,
      });
      return;
    }

    // Spin the slots
    const spin = () => symbols[Math.floor(Math.random() * symbols.length)]!;
    const slot1 = spin();
    const slot2 = spin();
    const slot3 = spin();

    // Calculate winnings
    let winAmount = 0;
    let multiplier = 0;

    if (slot1 === slot2 && slot2 === slot3) {
      // All three match!
      multiplier = payouts[slot1];
      winAmount = bet * multiplier;
    } else if (slot1 === slot2 || slot2 === slot3) {
      // Two match
      multiplier = 1.5;
      winAmount = Math.floor(bet * multiplier);
    }

    const profit = winAmount - bet;
    const newBalance = userEcon.coins + profit;

    // Update database
    await prisma.userEconomy.update({
      where: { userId },
      data: {
        coins: newBalance,
        totalWagered: userEcon.totalWagered + bet,
        totalWon: userEcon.totalWon + winAmount,
        gamesPlayed: userEcon.gamesPlayed + 1,
      },
    });

    const embed = new EmbedBuilder()
      .setColor(profit > 0 ? ZENITSU_THEME.SUCCESS : ZENITSU_THEME.ERROR)
      .setTitle(`Slot Machine`)
      .setDescription(`**Bet:** ${bet.toLocaleString()}\n\u200b`)
      .addFields([
        {
          name: 'Results',
          // Monospaced so the reel columns stay aligned whatever lands.
          value: ['```', `| ${pad(slot1)} | ${pad(slot2)} | ${pad(slot3)} |`, '```'].join('\n'),
          inline: false,
        },
      ]);

    if (profit > 0) {
      embed.addFields([
        {
          name: `YOU WON!`,
          value:
            (multiplier > 1.5 ? `**JACKPOT! All ${slot1} match!**\n` : '**Two symbols match!**\n') +
            `\n**Multiplier:** ${multiplier}x\n` +
            `**Won:** +${winAmount.toLocaleString()}\n` +
            `**Profit:** +${profit.toLocaleString()}\n\u200b`,
          inline: false,
        },
      ]);
    } else {
      embed.addFields([
        {
          name: `No match...`,
          value: `**Lost:** -${bet.toLocaleString()}\n\u200b`,
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
        name: 'This Spin',
        value: profit >= 0 ? `+${profit.toLocaleString()}` : `${profit.toLocaleString()}`,
        inline: true,
      },
    ]);

    embed.setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
