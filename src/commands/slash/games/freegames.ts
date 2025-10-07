import { EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

interface FreeGame {
  title: string;
  url: string;
  image?: string;
  description?: string;
  endDate?: string;
}

export const freegames = {
  data: { name: 'freegames' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    // Fetch free games from multiple sources
    const [epicGames, steamRecentlyFree] = await Promise.allSettled([
      fetchEpicFreeGames(),
      fetchSteamRecentlyFreeGames(),
    ]);

    const embeds: EmbedBuilder[] = [];

    // Epic Games - Separate embed with images
    if (epicGames.status === 'fulfilled' && epicGames.value.length > 0) {
      const epicEmbed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`${EMOTES.FLUENT_SPARKLES} Epic Games - Free This Week`)
        .setDescription(`**${epicGames.value.length} game${epicGames.value.length > 1 ? 's' : ''} available for free!**\n\u200b`)
        .setThumbnail('https://cdn2.unrealengine.com/Epic+Games+Node+Placeholder-1920x1080-d1bb53e1ec82.png');

      for (const game of epicGames.value) {
        const gameValue = 
          `[🎮 **Get it FREE on Epic Games**](${game.url})\n` +
          (game.description ? `${game.description.slice(0, 120)}...\n` : '') +
          (game.endDate ? `⏰ **Available until:** ${game.endDate}\n` : '') +
          `\u200b`;
        
        epicEmbed.addFields([{
          name: game.title,
          value: gameValue,
          inline: false
        }]);
      }

      // Add first game's image
      if (epicGames.value[0]?.image) {
        epicEmbed.setImage(epicGames.value[0].image);
      }

      epicEmbed.setFooter({ text: 'Claim them before they\'re gone! Free games update every Thursday ⚡' });
      epicEmbed.setTimestamp();
      embeds.push(epicEmbed);
    } else {
      const noEpicEmbed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`${EMOTES.FLUENT_SPARKLES} Epic Games - Free This Week`)
        .setDescription(`${EMOTES.CONFUSED_CAT} No free games available on Epic right now.\nCheck back Thursday for new free games!`)
        .setThumbnail('https://cdn2.unrealengine.com/Epic+Games+Node+Placeholder-1920x1080-d1bb53e1ec82.png')
        .setFooter({ text: 'Epic Games updates every Thursday at 11 AM ET ⚡' })
        .setTimestamp();
      embeds.push(noEpicEmbed);
    }

    // Steam Recently Free & F2P Games
    if (steamRecentlyFree.status === 'fulfilled' && steamRecentlyFree.value.length > 0) {
      const steamEmbed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle('🎮 Steam - Recently Free & Top F2P Games')
        .setDescription('**Popular Steam games that recently became free or are free-to-play!**\n\u200b')
        .setThumbnail('https://store.cloudflare.steamstatic.com/public/shared/images/header/logo_steam.svg');

      // Show top games
      const topGames = steamRecentlyFree.value.slice(0, 8);
      const gamesList = topGames
        .map(g => `${EMOTES.BULLET} **[${g.title}](${g.url})**${g.description ? `\n  *${g.description.slice(0, 70)}...*` : ''}`)
        .join('\n\n');

      steamEmbed.addFields([{
        name: '⚡ Free-to-Play Games',
        value: gamesList + '\n\u200b',
        inline: false
      }]);

      // Add image from first game
      if (topGames[0]?.image) {
        steamEmbed.setImage(topGames[0].image);
      }

      steamEmbed.addFields([{
        name: '🔗 More Free Games',
        value: 
          `${EMOTES.BULLET} [Browse All F2P on Steam](https://store.steampowered.com/genre/Free%20to%20Play/)\n` +
          `${EMOTES.BULLET} [New & Trending Free](https://store.steampowered.com/search/?maxprice=free&specials=1)\n` +
          `${EMOTES.BULLET} [Recently Released F2P](https://store.steampowered.com/search/?maxprice=free&filter=topsellers)`,
        inline: false
      }]);

      steamEmbed.setFooter({ text: 'Steam Free-to-Play Games ⚡' });
      steamEmbed.setTimestamp();
      embeds.push(steamEmbed);
    }

    await interaction.editReply({ embeds });
  } catch (err: any) {
    logger.error({ err }, 'Free games fetch error');
    await interaction.editReply(`${EMOTES.NOT_LIKE_THIS} Failed to fetch free games. Please try again later.`).catch(() => {});
  }
  }
};

async function fetchEpicFreeGames(): Promise<FreeGame[]> {
  try {
    // Epic Games free games API
    const url = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US';
    const response = await fetch(url);
    const data = await response.json() as any;

    const freeGames: FreeGame[] = [];
    const games = data.data?.Catalog?.searchStore?.elements || [];

    for (const game of games) {
      if (game.promotions?.promotionalOffers?.length > 0) {
        const promo = game.promotions.promotionalOffers[0]?.promotionalOffers[0];
        const isFree = game.price?.totalPrice?.discountPrice === 0;
        
        if (isFree) {
          // Get the best image
          const images = game.keyImages || [];
          const featuredImage = images.find((img: any) => img.type === 'OfferImageWide') ||
                               images.find((img: any) => img.type === 'DieselStoreFrontWide') ||
                               images.find((img: any) => img.type === 'Thumbnail') ||
                               images[0];

          freeGames.push({
            title: game.title,
            url: `https://store.epicgames.com/en-US/p/${game.productSlug || game.urlSlug || game.offerMappings?.[0]?.pageSlug}`,
            image: featuredImage?.url || undefined,
            description: game.description || undefined,
            endDate: promo?.endDate ? new Date(promo.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined
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

async function fetchSteamRecentlyFreeGames(): Promise<FreeGame[]> {
  try {
    // Fetch from Steam API for free-to-play games
    const url = 'https://store.steampowered.com/api/featured/';
    const response = await fetch(url);
    const data = await response.json() as any;

    const freeGames: FreeGame[] = [];

    // Add recently free or popular F2P games
    const popularF2P = [
      { 
        appid: 730, 
        title: 'Counter-Strike 2', 
        description: 'The world\'s #1 competitive FPS game',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg'
      },
      { 
        appid: 570, 
        title: 'Dota 2', 
        description: 'The most-played game on Steam',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg'
      },
      { 
        appid: 578080, 
        title: 'PUBG: BATTLEGROUNDS', 
        description: 'Now completely FREE to play',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/578080/header.jpg'
      },
      { 
        appid: 1172470, 
        title: 'Apex Legends', 
        description: 'Popular battle royale shooter',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/header.jpg'
      },
      { 
        appid: 230410, 
        title: 'Warframe', 
        description: 'Cooperative free-to-play action game',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/230410/header.jpg'
      },
      { 
        appid: 1938090, 
        title: 'Call of Duty®: Warzone™', 
        description: 'Free-to-play battle royale',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1938090/header.jpg'
      },
      { 
        appid: 394360, 
        title: 'Hearts of Iron IV', 
        description: 'Grand strategy game (Free weekends)',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/394360/header.jpg'
      },
      { 
        appid: 1623730, 
        title: 'Palworld', 
        description: 'Open-world survival crafting (Check for free events)',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/header.jpg'
      },
      {
        appid: 2073850,
        title: 'Marvel Rivals',
        description: 'Free-to-play hero shooter',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2073850/header.jpg'
      },
      {
        appid: 1966720,
        title: 'Overwatch® 2',
        description: 'Team-based action game',
        image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1966720/header.jpg'
      }
    ];

    for (const game of popularF2P) {
      freeGames.push({
        title: game.title,
        url: `https://store.steampowered.com/app/${game.appid}`,
        image: game.image,
        description: game.description
      });
    }

    return freeGames;
  } catch (err) {
    logger.error({ err }, 'Steam free games error');
    return [];
  }
}
