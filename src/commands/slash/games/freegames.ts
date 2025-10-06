import { SlashCommandBuilder, EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const data = new SlashCommandBuilder()
  .setName('freegames')
  .setDescription('Check current free games on Epic and Steam');

export async function execute(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    // Fetch free games from multiple sources
    const [epicGames, steamGames] = await Promise.allSettled([
      fetchEpicFreeGames(),
      fetchSteamFreeGames(),
    ]);

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('🎮 Free Games Available Now')
      .setTimestamp();

    // Epic Games
    if (epicGames.status === 'fulfilled' && epicGames.value.length > 0) {
      const epicList = epicGames.value.map(g => `• **[${g.title}](${g.url})**`).join('\n');
      embed.addFields([{ name: '🎁 Epic Games Store', value: epicList, inline: false }]);
    } else {
      embed.addFields([{ name: '🎁 Epic Games Store', value: 'No free games available right now.', inline: false }]);
    }

    // Steam Free-to-Play
    if (steamGames.status === 'fulfilled' && steamGames.value.length > 0) {
      const steamList = steamGames.value.slice(0, 5).map(g => `• **[${g.name}](${g.url})**`).join('\n');
      embed.addFields([{ name: '⚡ Steam Free-to-Play (Top 5)', value: steamList, inline: false }]);
    }

    embed.setFooter({ text: 'Check back regularly for new free games! ⚡' });

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    logger.error({ err }, 'Free games fetch error');
    await interaction.editReply('Failed to fetch free games. Please try again later.').catch(() => {});
  }
}

async function fetchEpicFreeGames() {
  try {
    // Epic Games free games API
    const url = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US';
    const response = await fetch(url);
    const data = await response.json() as any;

    const freeGames: Array<{ title: string; url: string }> = [];
    const games = data.data?.Catalog?.searchStore?.elements || [];

    for (const game of games) {
      if (game.promotions?.promotionalOffers?.length > 0 || game.promotions?.upcomingPromotionalOffers?.length > 0) {
        const isFree = game.promotions?.promotionalOffers?.length > 0;
        if (isFree && game.price?.totalPrice?.discountPrice === 0) {
          freeGames.push({
            title: game.title,
            url: `https://store.epicgames.com/en-US/p/${game.productSlug || game.urlSlug}`,
          });
        }
      }
    }

    return freeGames;
  } catch (err) {
    logger.error({ err }, 'Epic Games API error');
    return [];
  }
}

async function fetchSteamFreeGames() {
  try {
    // Steam free-to-play games (we'll just link popular ones)
    // Note: Steam doesn't have a direct "free this week" API like Epic
    const popularFreeGames = [
      { name: 'Counter-Strike 2', url: 'https://store.steampowered.com/app/730' },
      { name: 'Dota 2', url: 'https://store.steampowered.com/app/570' },
      { name: 'PUBG: Battlegrounds', url: 'https://store.steampowered.com/app/578080' },
      { name: 'Apex Legends', url: 'https://store.steampowered.com/app/1172470' },
      { name: 'Warframe', url: 'https://store.steampowered.com/app/230410' },
    ];

    return popularFreeGames;
  } catch (err) {
    logger.error({ err }, 'Steam free games error');
    return [];
  }
}

