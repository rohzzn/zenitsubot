import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

export const animeinfo = {
  data: {
    name: 'animeinfo',
    description: 'Get detailed anime information including reviews and ratings',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('name', true);
    
    await interaction.deferReply();
    
    try {
      // Search for anime
      const searchResponse = await fetch(
        `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`
      );
      
      if (!searchResponse.ok) {
        await interaction.editReply('❌ Failed to fetch anime info.');
        return;
      }
      
      const searchData: any = await searchResponse.json();
      
      if (!searchData?.data || searchData.data.length === 0) {
        await interaction.editReply(`❌ Anime "${query}" not found.`);
        return;
      }
      
      const anime: any = searchData.data[0];
      
      // Get full details
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
      const detailsResponse = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}/full`);
      const details: any = await detailsResponse.json();
      const fullAnime = details.data;
      
      // Get reviews
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
      const reviewsResponse = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}/reviews?limit=3`);
      const reviewsData: any = await reviewsResponse.json();
      const reviews = reviewsData.data || [];
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(fullAnime.title)
        .setURL(fullAnime.url)
        .setDescription(fullAnime.synopsis?.substring(0, 400) || 'No synopsis available')
        .addFields([
          { name: '⭐ Score', value: `${fullAnime.score || 'N/A'}/10 (${fullAnime.scored_by?.toLocaleString() || 0} users)`, inline: true },
          { name: '🏆 Rank', value: `#${fullAnime.rank || 'N/A'}`, inline: true },
          { name: '❤️ Popularity', value: `#${fullAnime.popularity || 'N/A'}`, inline: true },
          { name: '📺 Episodes', value: fullAnime.episodes?.toString() || 'Unknown', inline: true },
          { name: '⏱️ Duration', value: fullAnime.duration || 'Unknown', inline: true },
          { name: '📅 Status', value: fullAnime.status || 'Unknown', inline: true },
          { name: '🎬 Type', value: fullAnime.type || 'Unknown', inline: true },
          { name: '📅 Aired', value: fullAnime.aired?.string || 'Unknown', inline: true },
          { name: '🎭 Genres', value: fullAnime.genres?.map((g: any) => g.name).join(', ') || 'N/A', inline: true },
        ])
        .setImage(fullAnime.images.jpg.large_image_url)
        .setThumbnail(fullAnime.trailer?.images?.maximum_image_url || null);
      
      // Add studios and producers
      if (fullAnime.studios?.length > 0) {
        embed.addFields({
          name: '🏢 Studios',
          value: fullAnime.studios.map((s: any) => s.name).join(', '),
          inline: true,
        });
      }
      
      // Add top review
      if (reviews.length > 0) {
        const topReview = reviews[0];
        embed.addFields({
          name: `📝 Top Review by ${topReview.user.username}`,
          value: (topReview.review?.substring(0, 200) || 'No content') + '...',
        });
      }
      
      embed.setFooter({ text: `MyAnimeList • Members: ${fullAnime.members?.toLocaleString() || 'N/A'}` });
      embed.setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      console.error('Anime info error:', err);
      await interaction.editReply('❌ Error fetching anime info. Please try again.');
    }
  },
};

