import { EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

const EPIC_PROMOTIONS_URL =
  'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US';

interface FreeGame {
  title: string;
  url: string;
  image?: string;
  description?: string;
  endsAt?: Date;
}

export const freegames = {
  data: { name: 'freegames' },
  category: 'gaming',

  async execute(_client: Client, interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const games = await fetchEpicFreeGames();

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`Epic Games — Free This Week`)
        .setFooter({ text: 'Epic rotates free games every Thursday at 11am ET' })
        .setTimestamp();

      if (games.length === 0) {
        embed.setDescription(`No free games on Epic right now. Check back Thursday!`);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      embed.setDescription(
        `**${games.length} game${games.length > 1 ? 's' : ''} free to claim right now.**\n​`,
      );

      for (const game of games) {
        const parts = [`[Claim it on Epic Games](${game.url})`];
        if (game.description) parts.push(truncate(game.description, 140));
        if (game.endsAt) parts.push(`Free until <t:${Math.floor(game.endsAt.getTime() / 1000)}:D>`);

        embed.addFields([{ name: game.title, value: `${parts.join('\n')}\n​`, inline: false }]);
      }

      if (games[0]?.image) embed.setImage(games[0].image);

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, 'Free games fetch error');
      await interaction
        .editReply(`Failed to fetch free games. Please try again later.`)
        .catch(() => {});
    }
  },
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

async function fetchEpicFreeGames(): Promise<FreeGame[]> {
  const response = await fetch(EPIC_PROMOTIONS_URL);
  if (!response.ok) {
    logger.warn({ status: response.status }, 'Epic promotions request failed');
    return [];
  }

  const data = (await response.json()) as any;
  const elements = data?.data?.Catalog?.searchStore?.elements ?? [];
  const games: FreeGame[] = [];

  for (const game of elements) {
    // An entry appears here both for current and upcoming giveaways; only the
    // current ones are discounted to zero.
    if (game.price?.totalPrice?.discountPrice !== 0) continue;

    const offer = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
    if (!offer) continue;

    const images: Array<{ type?: string; url?: string }> = game.keyImages ?? [];
    const image =
      images.find((img) => img.type === 'OfferImageWide')?.url ??
      images.find((img) => img.type === 'DieselStoreFrontWide')?.url ??
      images.find((img) => img.type === 'Thumbnail')?.url ??
      images[0]?.url;

    const slug =
      game.productSlug ||
      game.urlSlug ||
      game.offerMappings?.[0]?.pageSlug ||
      game.catalogNs?.mappings?.[0]?.pageSlug;
    if (!slug) continue;

    games.push({
      title: game.title,
      url: `https://store.epicgames.com/en-US/p/${slug}`,
      image,
      description: game.description || undefined,
      endsAt: offer.endDate ? new Date(offer.endDate) : undefined,
    });
  }

  return games;
}
