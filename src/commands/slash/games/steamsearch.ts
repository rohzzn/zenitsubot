import { EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const steamsearch = {
  data: { name: 'steamsearch' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'game') {
      const query = interaction.options.getString('query', true);
      await searchSteamGame(interaction, query);
    } else if (subcommand === 'player') {
      const steamId = interaction.options.getString('steamid', true);
      await searchSteamPlayer(interaction, steamId);
    }
  }
};

async function searchSteamGame(interaction: ChatInputCommandInteraction, query: string) {
  try {
    await interaction.deferReply();

    // Steam Store API search
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=us&l=english`;
    const response = await fetch(searchUrl);
    const data = await response.json() as any;

    if (!data.items || data.items.length === 0) {
      await interaction.editReply('No games found for that query.');
      return;
    }

    const game = data.items[0];
    const appId = game.id;

    // Get detailed info from Steam API
    const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
    const detailsResponse = await fetch(detailsUrl);
    const detailsData = await detailsResponse.json() as any;

    const gameData = detailsData[appId]?.data;
    if (!gameData) {
      await interaction.editReply('Failed to fetch game details.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(gameData.name)
      .setDescription(gameData.short_description?.slice(0, 300) || 'No description available.')
      .setURL(`https://store.steampowered.com/app/${appId}`)
      .addFields([
        { name: 'Price', value: gameData.is_free ? 'Free' : (gameData.price_overview?.final_formatted || 'N/A'), inline: true },
        { name: 'Release Date', value: gameData.release_date?.date || 'TBA', inline: true },
        { name: 'Developer', value: gameData.developers?.join(', ') || 'Unknown', inline: true },
        { name: 'Genres', value: gameData.genres?.map((g: any) => g.description).join(', ') || 'N/A', inline: false },
      ])
      .setImage(gameData.header_image)
      .setFooter({ text: `Steam App ID: ${appId}` });

    if (gameData.metacritic) {
      embed.addFields([{ name: 'Metacritic Score', value: `${gameData.metacritic.score}/100`, inline: true }]);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    logger.error({ err, query }, 'Steam game search error');
    await interaction.editReply('Failed to search Steam. Please try again later.').catch(() => {});
  }
}

async function searchSteamPlayer(interaction: ChatInputCommandInteraction, steamId: string) {
  try {
    await interaction.deferReply();

    // Extract Steam ID from URL if needed
    let extractedId = steamId;
    const urlMatch = steamId.match(/steamcommunity\.com\/(id|profiles)\/([^\/]+)/);
    if (urlMatch) {
      extractedId = urlMatch[2] || steamId;
    }

    // Note: Steam Web API requires API key for player summaries
    // For public data without key, we'll show basic info
    const profileUrl = steamId.includes('steamcommunity.com') 
      ? steamId 
      : `https://steamcommunity.com/id/${extractedId}`;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('Steam Player Profile')
      .setDescription(`[View Full Profile](${profileUrl})`)
      .addFields([
        { name: 'Steam ID/URL', value: extractedId, inline: false },
        { name: 'Note', value: 'Full player stats require Steam API key. Visit the profile link for details.', inline: false },
      ])
      .setFooter({ text: '⚡ Steam Player Lookup' });

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    logger.error({ err, steamId }, 'Steam player search error');
    await interaction.editReply('Failed to search for player.').catch(() => {});
  }
}

