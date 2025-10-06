import { SlashCommandBuilder, EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const data = new SlashCommandBuilder()
  .setName('gamesearch')
  .setDescription('Search for game info with ratings and reviews')
  .addStringOption(opt => opt.setName('game').setDescription('Game name to search').setRequired(true));

export async function execute(client: Client, interaction: ChatInputCommandInteraction) {
  const gameName = (interaction as any).options.getString('game');

  try {
    await interaction.deferReply();

    // Use RAWG API (free, no key required for basic searches)
    const searchUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(gameName)}&page_size=1`;
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json() as any;

    if (!searchData.results || searchData.results.length === 0) {
      await interaction.editReply('No games found for that query.');
      return;
    }

    const game = searchData.results[0];

    // Get detailed info
    const detailsUrl = `https://api.rawg.io/api/games/${game.id}`;
    const detailsResponse = await fetch(detailsUrl);
    const details = await detailsResponse.json() as any;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(details.name)
      .setURL(details.website || `https://rawg.io/games/${details.slug}`)
      .setDescription(stripHtml(details.description_raw?.slice(0, 400) || 'No description available.'))
      .addFields([
        { name: 'Rating', value: `⭐ ${details.rating || 'N/A'}/5 (${details.ratings_count || 0} ratings)`, inline: true },
        { name: 'Metacritic', value: details.metacritic ? `${details.metacritic}/100` : 'N/A', inline: true },
        { name: 'Released', value: details.released || 'TBA', inline: true },
        { name: 'Platforms', value: details.platforms?.slice(0, 3).map((p: any) => p.platform.name).join(', ') || 'N/A', inline: false },
        { name: 'Genres', value: details.genres?.map((g: any) => g.name).join(', ') || 'N/A', inline: false },
        { name: 'Developers', value: details.developers?.map((d: any) => d.name).join(', ') || 'Unknown', inline: true },
        { name: 'Publishers', value: details.publishers?.map((p: any) => p.name).join(', ') || 'Unknown', inline: true },
      ]);

    if (details.background_image) {
      embed.setImage(details.background_image);
    }

    // Add top tags
    if (details.tags && details.tags.length > 0) {
      const topTags = details.tags.slice(0, 5).map((t: any) => t.name).join(', ');
      embed.addFields([{ name: 'Tags', value: topTags, inline: false }]);
    }

    // Add ESRB rating if available
    if (details.esrb_rating) {
      embed.addFields([{ name: 'ESRB Rating', value: details.esrb_rating.name, inline: true }]);
    }

    embed.setFooter({ text: `⚡ Powered by RAWG • ID: ${details.id}` });
    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    logger.error({ err, gameName }, 'Game search error');
    await interaction.editReply('Failed to search for game. Please try again later.').catch(() => {});
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\n\n+/g, '\n');
}

