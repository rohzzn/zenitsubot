import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

export const animeupcoming = {
  data: {
    name: 'animeupcoming',
    description: 'See top 5 upcoming anime episodes airing soon',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      // Get currently airing anime
      const response = await fetch(
        'https://api.jikan.moe/v4/schedules?filter=monday,tuesday,wednesday,thursday,friday,saturday,sunday&limit=20',
      );

      if (!response.ok) {
        await interaction.editReply('Failed to fetch upcoming episodes.');
        return;
      }

      const data: any = await response.json();

      if (!data?.data || data.data.length === 0) {
        await interaction.editReply('No upcoming episodes found.');
        return;
      }

      const animeList: any[] = data.data;

      // Sort by score and popularity
      const topAnime = animeList
        .filter((a: any) => a.score && a.score > 7)
        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
        .slice(0, 5);

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('Top 5 Upcoming Anime Episodes')
        .setDescription('Currently airing anime with new episodes coming soon!')
        .setTimestamp();

      topAnime.forEach((anime: any, index: number) => {
        const airInfo = anime.broadcast?.string || 'Unknown time';
        const nextEp = anime.episodes ? `Episode ${anime.episodes}` : 'TBA';

        embed.addFields({
          name: `${index + 1}. ${anime.title}`,
          value:
            `${anime.score || 'N/A'}/10 • ${nextEp}\n` +
            `${airInfo}\n` +
            `[View on MAL](${anime.url})`,
          inline: false,
        });
      });

      if (topAnime.length > 0 && topAnime[0]?.images?.jpg?.large_image_url) {
        embed.setThumbnail(topAnime[0].images.jpg.large_image_url);
      }

      embed.setFooter({ text: 'MyAnimeList • Updates every week' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      console.error('Upcoming anime error:', err);
      await interaction.editReply('Error fetching upcoming episodes. Please try again.');
    }
  },
};
