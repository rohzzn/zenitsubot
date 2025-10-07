import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const animairing = {
  data: {
    name: 'animairing',
    description: 'View currently airing anime this season',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply();

      // Get current season and year
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      
      let season = 'winter';
      if (month >= 4 && month <= 6) season = 'spring';
      else if (month >= 7 && month <= 9) season = 'summer';
      else if (month >= 10 && month <= 12) season = 'fall';

      // Fetch current season anime from Jikan API
      const url = `https://api.jikan.moe/v4/seasons/${year}/${season}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        await interaction.editReply(`${EMOTES.CONFUSED_CAT} Failed to fetch airing anime.`);
        return;
      }

      const data = await response.json() as any;
      const animeList = data.data || [];

      if (animeList.length === 0) {
        await interaction.editReply(`${EMOTES.THINK} No airing anime found for this season.`);
        return;
      }

      // Get top 10 by popularity/score
      const topAiring = animeList
        .filter((anime: any) => anime.airing)
        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
        .slice(0, 10);

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`${EMOTES.FLUENT_SPARKLES} Currently Airing Anime`)
        .setDescription(
          `**${season.charAt(0).toUpperCase() + season.slice(1)} ${year} Season**\n\n` +
          topAiring.map((anime: any, index: number) => {
            const score = anime.score ? `⭐ ${anime.score}` : 'N/A';
            const episodes = anime.episodes ? `${anime.episodes} eps` : 'Ongoing';
            return `${EMOTES.BULLET} **${index + 1}. [${anime.title}](${anime.url})**\n` +
                   `   ${score} • ${episodes} • ${anime.type || 'TV'}\n\u200b`;
          }).join('\n')
        )
        .setFooter({ text: `Showing top ${topAiring.length} airing anime • Powered by Jikan` })
        .setTimestamp();

      if (topAiring[0]?.images?.jpg?.large_image_url) {
        embed.setThumbnail(topAiring[0].images.jpg.large_image_url);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      logger.error({ err }, 'Anime airing command error');
      await interaction.editReply(`${EMOTES.YIKES} An error occurred while fetching airing anime.`).catch(() => {});
    }
  },
};



