import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

const suits = ['♠️', '♥️', '♣️', '♦️'];
const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function getCardValue(card: { value: string }, total: number): number {
  if (card.value === 'A') {
    return total + 11 > 21 ? 1 : 11;
  }
  if (['J', 'Q', 'K'].includes(card.value)) {
    return 10;
  }
  return parseInt(card.value);
}

function calculateHand(hand: { value: string }[]): number {
  let total = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (card.value === 'A') {
      aces++;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.value)) {
      total += 10;
    } else {
      total += parseInt(card.value);
    }
  }
  
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  
  return total;
}

function formatHand(hand: { suit: string; value: string }[]): string {
  return hand.map(c => `${c.value}${c.suit}`).join(' ');
}

// Store active games
const activeGames = new Map<string, any>();

export const blackjack = {
  data: {
    name: 'blackjack',
    description: 'Play blackjack and bet your coins!',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const bet = interaction.options.getInteger('bet', true);
    
    if (bet < 10) {
      await interaction.reply({ content: '❌ Minimum bet is 10 coins!', ephemeral: true });
      return;
    }
    
    if (bet > 10000) {
      await interaction.reply({ content: '❌ Maximum bet is 10,000 coins!', ephemeral: true });
      return;
    }
    
    const prisma = getPrisma();
    const userId = interaction.user.id;
    const guildId = interaction.guildId!;
    
    // Get or create user economy
    let userEcon = await prisma.userEconomy.findUnique({
      where: { userId_guildId: { userId, guildId } }
    });
    
    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: { userId, guildId, coins: 1000 } // Starting coins
      });
    }
    
    if (userEcon.coins < bet) {
      await interaction.reply({ 
        content: `❌ W-wait! You only have ${userEcon.coins} coins! 😰`, 
        ephemeral: true 
      });
      return;
    }
    
    // Check if user already has active game
    if (activeGames.has(userId)) {
      await interaction.reply({ content: '❌ You already have an active game!', ephemeral: true });
      return;
    }
    
    // Start game
    const deck = createDeck();
    const playerHand = [deck.pop()!, deck.pop()!];
    const dealerHand = [deck.pop()!, deck.pop()!];
    
    const game = {
      deck,
      playerHand,
      dealerHand,
      bet,
      userId,
      guildId
    };
    
    activeGames.set(userId, game);
    
    const playerTotal = calculateHand(playerHand);
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`${EMOTES.FLUENT_SPARKLES} Blackjack!`)
      .setDescription(`Bet: **${bet}** coins`)
      .addFields([
        { name: '🎴 Your Hand', value: `${formatHand(playerHand)}\nTotal: **${playerTotal}**`, inline: true },
        { name: '🎴 Dealer', value: `${dealerHand[0]!.value}${dealerHand[0]!.suit} 🂠\nTotal: **?**`, inline: true }
      ])
      .setFooter({ text: 'Good luck! ⚡' });
    
    // Check for instant blackjack
    if (playerTotal === 21) {
      const winAmount = Math.floor(bet * 1.5);
      await prisma.userEconomy.update({
        where: { userId_guildId: { userId, guildId } },
        data: { coins: userEcon.coins + winAmount }
      });
      
      embed.setDescription(`**BLACKJACK!** ⚡\nYou won **${winAmount}** coins! 💛`);
      embed.setColor(ZENITSU_THEME.SUCCESS);
      activeGames.delete(userId);
      await interaction.reply({ embeds: [embed] });
      return;
    }
    
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_hit_${userId}`)
        .setLabel('Hit')
        .setEmoji(EMOTES.UPVOTE)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`bj_stand_${userId}`)
        .setLabel('Stand')
        .setEmoji(EMOTES.DOWNVOTE)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`bj_double_${userId}`)
        .setLabel('Double Down')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(userEcon.coins < bet * 2)
    );
    
    await interaction.reply({ embeds: [embed], components: [buttons] });
    
    // Auto-cleanup after 2 minutes
    setTimeout(() => {
      if (activeGames.has(userId)) {
        activeGames.delete(userId);
      }
    }, 120000);
  },
};

// Export the game state for button handlers
export { activeGames, calculateHand, formatHand };

