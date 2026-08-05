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

      // Use /seasons/now rather than computing the season and requesting
      // /seasons/{year}/{season}: it is what "airing this season" actually
      // means, and it is the only Jikan season route that currently responds
      // (the dated form returns 504).
      const response = await fetch('https://api.jikan.moe/v4/seasons/now');

      if (!response.ok) {
        await interaction.editReply(`Failed to fetch airing anime.`);
        return;
      }

      const data = (await response.json()) as any;
      const animeList = data.data || [];

      if (animeList.length === 0) {
        await interaction.editReply(`No airing anime found for this season.`);
        return;
      }

      // Get top 10 by popularity/score
      const topAiring = animeList
        .filter((anime: any) => anime.airing)
        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
        .slice(0, 10);

      // /seasons/now does not label the season at the top level, so take it
      // from the entries themselves.
      const labelled = animeList.find((a: any) => a.season && a.year);
      const seasonLabel = labelled
        ? `${labelled.season.charAt(0).toUpperCase()}${labelled.season.slice(1)} ${labelled.year} Season`
        : 'This Season';

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`Currently Airing Anime`)
        .setDescription(
          `**${seasonLabel}**\n\n` +
            topAiring
              .map((anime: any, index: number) => {
                const score = anime.score ? `${anime.score}` : 'N/A';
                const episodes = anime.episodes ? `${anime.episodes} eps` : 'Ongoing';
                return (
                  `**${index + 1}. [${anime.title}](${anime.url})**\n` +
                  `   ${score} • ${episodes} • ${anime.type || 'TV'}\n\u200b`
                );
              })
              .join('\n'),
        )
        .setFooter({ text: `Showing top ${topAiring.length} airing anime • Powered by Jikan` })
        .setTimestamp();

      if (topAiring[0]?.images?.jpg?.large_image_url) {
        embed.setThumbnail(topAiring[0].images.jpg.large_image_url);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      logger.error({ err }, 'Anime airing command error');
      await interaction.editReply(`An error occurred while fetching airing anime.`).catch(() => {});
    }
  },
};
