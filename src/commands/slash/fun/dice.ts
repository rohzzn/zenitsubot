import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const dice = {
  data: {
    name: 'dice',
    description: 'Roll dice and bet on the outcome! Roll higher than 50 to win!',
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
    
    if (bet > 10000) {
      await interaction.reply({ 
        content: `${EMOTES.NOT_LIKE_THIS} Maximum bet is 10,000 coins!`, 
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
    
    // Roll the dice (1-100)
    const roll = Math.floor(Math.random() * 100) + 1;
    
    // Calculate multiplier based on roll
    let multiplier = 0;
    let won = false;
    
    if (roll >= 90) {
      multiplier = 3; // 3x for 90-100
      won = true;
    } else if (roll >= 75) {
      multiplier = 2; // 2x for 75-89
      won = true;
    } else if (roll >= 50) {
      multiplier = 1.5; // 1.5x for 50-74
      won = true;
    }
    
    const winAmount = won ? Math.floor(bet * multiplier) : 0;
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
    
    // Determine dice emoji based on roll
    let diceEmoji = '🎲';
    if (roll >= 90) diceEmoji = '🎯';
    else if (roll >= 75) diceEmoji = '🔥';
    else if (roll >= 50) diceEmoji = '⚡';
    
    const embed = new EmbedBuilder()
      .setColor(won ? ZENITSU_THEME.SUCCESS : ZENITSU_THEME.ERROR)
      .setTitle(`${EMOTES.FLUENT_SPARKLES} Dice Roll`)
      .setDescription(
        `**Bet:** ${bet.toLocaleString()} 💛\n` +
        `**Goal:** Roll 50 or higher to win!\n\u200b`
      )
      .addFields([
        {
          name: '🎲 Your Roll',
          value: `# ${diceEmoji} ${roll}\n\u200b`,
          inline: false
        }
      ]);
    
    if (won) {
      let tier = '';
      if (roll >= 90) tier = '**LEGENDARY!** 🎯';
      else if (roll >= 75) tier = '**EPIC!** 🔥';
      else if (roll >= 50) tier = '**Nice!** ⚡';
      
      embed.addFields([
        {
          name: `${EMOTES.ZENITSU_HEARTEYES} YOU WON!`,
          value: 
            `${tier}\n\n` +
            `${EMOTES.BULLET} **Multiplier:** ${multiplier}x\n` +
            `${EMOTES.BULLET} **Won:** ${winAmount.toLocaleString()} 💛\n` +
            `${EMOTES.BULLET} **Profit:** +${profit.toLocaleString()} 💛\n\u200b`,
          inline: false
        }
      ]);
    } else {
      embed.addFields([
        {
          name: `${EMOTES.ZENITSU_DEAD} Too Low...`,
          value: 
            `You need 50+ to win!\n\n` +
            `${EMOTES.BULLET} **Lost:** -${bet.toLocaleString()} 💛\n\u200b`,
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
        name: '📊 This Roll',
        value: won ? `+${profit.toLocaleString()} 💛` : `${profit.toLocaleString()} 💛`,
        inline: true
      }
    ]);
    
    embed.addFields([
      {
        name: '📈 Multipliers',
        value: 
          `${EMOTES.BULLET} 50-74: **1.5x**\n` +
          `${EMOTES.BULLET} 75-89: **2x** 🔥\n` +
          `${EMOTES.BULLET} 90-100: **3x** 🎯`,
        inline: false
      }
    ]);
    
    embed.setFooter({ text: 'Roll high to win big! ⚡' });
    embed.setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};

