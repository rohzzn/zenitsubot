import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { brandEmbed, sendPaged } from '../../../utils/ui.js';
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

      if (games.length === 0) {
        await interaction.editReply({
          embeds: [
            brandEmbed({
              author: { name: 'Epic Games' },
              title: 'Nothing free right now',
              description: 'Epic rotates its free games every Thursday at 11am ET.',
            }),
          ],
        });
        return;
      }

      // A card each, so every game gets its own key art rather than one
      // shared banner for the whole list.
      const pages = games.map((game, index) =>
        brandEmbed({
          author: { name: `Epic Games - free this week (${index + 1}/${games.length})` },
          title: game.title,
          url: game.url,
          description: game.description ? truncate(game.description, 300) : undefined,
          image: game.image,
          footer: game.endsAt
            ? `Free until ${game.endsAt.toUTCString().slice(0, 16)}`
            : 'Claim it while it lasts',
        }).addFields({ name: 'Claim', value: `[Open on Epic Games](${game.url})`, inline: false }),
      );

      await sendPaged(interaction, pages);
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
