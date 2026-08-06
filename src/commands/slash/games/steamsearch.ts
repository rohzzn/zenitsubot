import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { brandEmbed, sendPaged } from '../../../utils/ui.js';
import { logger } from '../../../services/logger.js';

const STEAM_BLUE = 0x1b2838;
const MAX_RESULTS = 6;

interface StoreSearchItem {
  id: number;
  name: string;
  tiny_image?: string;
}

interface AppDetails {
  name: string;
  short_description?: string;
  header_image?: string;
  is_free?: boolean;
  price_overview?: { final_formatted?: string; discount_percent?: number };
  release_date?: { date?: string; coming_soon?: boolean };
  developers?: string[];
  publishers?: string[];
  genres?: Array<{ description: string }>;
  metacritic?: { score: number };
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  screenshots?: Array<{ path_full?: string }>;
  categories?: Array<{ description: string }>;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const steamsearch = {
  data: { name: 'steamsearch' },
  category: 'gaming',

  async execute(_client: Client, interaction: ChatInputCommandInteraction) {
    const query = interaction.options.getString('query', true).trim();
    await interaction.deferReply();

    try {
      const search = await fetchJson<{ items?: StoreSearchItem[] }>(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=us&l=english`,
      );

      const items = (search?.items ?? []).slice(0, MAX_RESULTS);
      if (items.length === 0) {
        await interaction.editReply(`No games found for **${query}**.`);
        return;
      }

      // Details are a request each, so they run together rather than in series.
      const detailed = await Promise.all(
        items.map(async (item) => {
          const data = await fetchJson<Record<string, { data?: AppDetails }>>(
            `https://store.steampowered.com/api/appdetails?appids=${item.id}`,
          );
          return { item, details: data?.[item.id]?.data };
        }),
      );

      const pages = detailed.map(({ item, details }, index) => {
        const url = `https://store.steampowered.com/app/${item.id}`;
        const position = `${index + 1}/${detailed.length}`;

        if (!details) {
          return brandEmbed({
            color: STEAM_BLUE,
            author: { name: `Steam - ${position}` },
            title: item.name,
            url,
            description: 'Steam returned no details for this title.',
            image: item.tiny_image,
          });
        }

        const price = details.is_free
          ? 'Free to play'
          : (details.price_overview?.final_formatted ?? 'Not priced');
        const discount = details.price_overview?.discount_percent;

        const platforms = [
          details.platforms?.windows ? 'Windows' : null,
          details.platforms?.mac ? 'macOS' : null,
          details.platforms?.linux ? 'Linux' : null,
        ].filter(Boolean);

        const embed = brandEmbed({
          color: STEAM_BLUE,
          author: { name: `Steam - ${position}` },
          title: details.name,
          url,
          description: details.short_description?.slice(0, 400),
          // Header art first; a screenshot is a decent fallback.
          image: details.header_image ?? details.screenshots?.[0]?.path_full,
          footer: `App ID ${item.id}`,
        });

        embed.addFields(
          {
            name: 'Price',
            value: discount ? `${price}  (-${discount}%)` : price,
            inline: true,
          },
          {
            name: 'Released',
            value: details.release_date?.coming_soon
              ? (details.release_date.date ?? 'Coming soon')
              : (details.release_date?.date ?? 'Unknown'),
            inline: true,
          },
          {
            name: 'Metacritic',
            value: details.metacritic ? `${details.metacritic.score}/100` : '-',
            inline: true,
          },
          {
            name: 'Developer',
            value: (details.developers ?? []).join(', ').slice(0, 200) || 'Unknown',
            inline: true,
          },
          {
            name: 'Platforms',
            value: platforms.join(', ') || 'Unknown',
            inline: true,
          },
          {
            name: 'Genres',
            value:
              (details.genres ?? [])
                .map((g) => g.description)
                .join(', ')
                .slice(0, 200) || '-',
            inline: true,
          },
        );

        return embed;
      });

      await sendPaged(interaction, pages);
    } catch (err) {
      logger.error({ err, query }, 'Steam search failed');
      await interaction.editReply('Steam search failed. Try again later.').catch(() => {});
    }
  },
};
