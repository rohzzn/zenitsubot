import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

interface JikanAnimeSearchResult {
  mal_id: number;
  title: string;
  title_english: string | null;
  episodes: number | null;
  score: number | null;
  status: string;
  type: string;
  year: number | null;
  images: {
    jpg: {
      large_image_url: string;
    };
  };
  synopsis: string;
  url: string;
}

export const animesearch = {
  data: {
    name: 'animesearch',
    description: 'Search for anime on MyAnimeList',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true);

    await interaction.deferReply();

    try {
      const response = await fetch(
        `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5&order_by=popularity&sort=asc`,
      );

      if (!response.ok) {
        await interaction.editReply('Failed to search anime. Try again later.');
        return;
      }

      const data: any = await response.json();

      if (!data?.data || data.data.length === 0) {
        await interaction.editReply(`No anime found for"${query}"`);
        return;
      }

      const results: JikanAnimeSearchResult[] = data.data;
      const anime = results[0]!;

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`${anime.title}`)
        .setURL(anime.url)
        .setDescription(
          (anime.synopsis?.substring(0, 300) || 'No synopsis available') +
            (anime.synopsis && anime.synopsis.length > 300 ? '...' : ''),
        )
        .addFields([
          { name: 'Score', value: anime.score ? `${anime.score}/10` : 'N/A', inline: true },
          { name: 'Episodes', value: anime.episodes?.toString() || 'Unknown', inline: true },
          { name: 'Status', value: anime.status || 'Unknown', inline: true },
          { name: 'Type', value: anime.type || 'Unknown', inline: true },
          { name: 'Year', value: anime.year?.toString() || 'Unknown', inline: true },
          { name: 'MAL ID', value: anime.mal_id.toString(), inline: true },
        ])
        .setImage(anime.images.jpg.large_image_url)
        .setFooter({ text: 'Found it! Please enjoy! | MyAnimeList' })
        .setTimestamp();

      // Show other results
      let otherResults = '';
      if (results.length > 1) {
        otherResults =
          '\n\n**Other Results:**\n' +
          results
            .slice(1)
            .map((a, i) => `${i + 2}. [${a.title}](${a.url}) - ${a.score || 'N/A'}/10`)
            .join('\n');
      }

      await interaction.editReply({
        content: otherResults || undefined,
        embeds: [embed],
      });
    } catch (err: any) {
      console.error('Anime search error:', err);
      await interaction.editReply('Error searching anime. Please try again.');
    }
  },
};
