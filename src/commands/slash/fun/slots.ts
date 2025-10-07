import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

const symbols = ['🍒', '🍋', '🍊', '🍉', '⭐', '💎', '7️⃣'];
const payouts = {
  '🍒': 2,
  '🍋': 3,
  '🍊': 4,
  '🍉': 5,
  '⭐': 10,
  '💎': 20,
  '7️⃣': 50
};

export const slots = {
  data: {
    name: 'slots',
    description: 'Play the slot machine!',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const bet = interaction.options.getInteger('bet', true);
    
    if (bet < 10) {
      await interaction.reply({ 
        content: `${EMOTES.NOT_LIKE_THIS} Minimum bet is 10 coins!`, 
        ephemeral: true 
      });
      return;
    }
    
    if (bet > 5000) {
      await interaction.reply({ 
        content: `${EMOTES.NOT_LIKE_THIS} Maximum bet is 5,000 coins!`, 
        ephemeral: true 
      });
      return;
    }
    
    const prisma = getPrisma();
    const userId = interaction.user.id;
    
    let userEcon = await prisma.userEconomy.findUnique({
      where: { userId }
    });
    
    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: { userId, coins: 1000 }
      });
    }
    
    if (userEcon.coins < bet) {
      await interaction.reply({ 
        content: `${EMOTES.ANIME_CRYING} W-wait! You only have ${userEcon.coins.toLocaleString()} coins! 😰`, 
        ephemeral: true 
      });
      return;
    }
    
    // Spin the slots
    const slot1 = symbols[Math.floor(Math.random() * symbols.length)];
    const slot2 = symbols[Math.floor(Math.random() * symbols.length)];
    const slot3 = symbols[Math.floor(Math.random() * symbols.length)];
    
    // Calculate winnings
    let winAmount = 0;
    let multiplier = 0;
    
    if (slot1 === slot2 && slot2 === slot3) {
      // All three match!
      multiplier = payouts[slot1 as keyof typeof payouts];
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
        gamesPlayed: userEcon.gamesPlayed + 1
      }
    });
    
    const embed = new EmbedBuilder()
      .setColor(profit > 0 ? ZENITSU_THEME.SUCCESS : ZENITSU_THEME.ERROR)
      .setTitle(`${EMOTES.FLUENT_SPARKLES} Slot Machine`)
      .setDescription(
        `**Bet:** ${bet.toLocaleString()} 💛\n\u200b`
      )
      .addFields([
        {
          name: '🎰 Results',
          value: `╔═══════════╗\n║  ${slot1}  ${slot2}  ${slot3}  ║\n╚═══════════╝\n\u200b`,
          inline: false
        }
      ]);
    
    if (profit > 0) {
      embed.addFields([
        {
          name: `${EMOTES.ZENITSU_HEARTEYES} YOU WON!`,
          value: 
            (multiplier > 1.5 ? `**JACKPOT! All ${slot1} match!**\n` : '**Two symbols match!**\n') +
            `\n${EMOTES.BULLET} **Multiplier:** ${multiplier}x\n` +
            `${EMOTES.BULLET} **Won:** +${winAmount.toLocaleString()} 💛\n` +
            `${EMOTES.BULLET} **Profit:** +${profit.toLocaleString()} 💛\n\u200b`,
          inline: false
        }
      ]);
    } else {
      embed.addFields([
        {
          name: `${EMOTES.ZENITSU_DEAD} No match...`,
          value: `Better luck next time!\n${EMOTES.BULLET} **Lost:** -${bet.toLocaleString()} 💛\n\u200b`,
          inline: false
        }
      ]);
    }
    
    embed.addFields([
      {
        name: '💰 New Balance',
        value: `**${newBalance.toLocaleString()}** coins`,
        inline: true
      },
      {
        name: '📊 This Spin',
        value: profit >= 0 ? `+${profit.toLocaleString()} 💛` : `${profit.toLocaleString()} 💛`,
        inline: true
      }
    ]);
    
    embed.setFooter({ text: 'Try your luck again! ⚡' });
    embed.setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};

