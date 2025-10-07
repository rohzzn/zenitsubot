import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { getPrisma } from './db.js';
import { logger } from './logger.js';

interface AnimeEpisode {
  mal_id: number;
  title: string;
  episodes: number;
  url: string;
  images: {
    jpg: {
      large_image_url: string;
    };
  };
}

export function startAnimeChecker(client: Client) {
  // Check every 30 minutes
  setInterval(() => checkForNewEpisodes(client), 30 * 60 * 1000);
  
  // Initial check after 2 minutes
  setTimeout(() => checkForNewEpisodes(client), 2 * 60 * 1000);
  
  logger.info('Anime episode checker started');
}

async function checkForNewEpisodes(client: Client) {
  const prisma = getPrisma();
  
  try {
    const alerts = await prisma.animeAlert.findMany();
    
    for (const alert of alerts) {
      try {
        // Search for anime on MAL via Jikan API
        const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(alert.animeName)}&limit=1`;
        const response = await fetch(searchUrl);
        
        if (!response.ok) {
          logger.warn({ anime: alert.animeName, status: response.status }, 'Failed to fetch anime data');
          continue;
        }
        
        const data: any = await response.json();
        
        if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
          continue;
        }
        
        const anime: AnimeEpisode = data.data[0] as AnimeEpisode;
        const currentEpisodes = anime.episodes || 0;
        
        // Check if there are new episodes
        if (currentEpisodes > alert.lastEpisode) {
          const guild = client.guilds.cache.get(alert.guildId);
          if (!guild) continue;
          
          const channel = guild.channels.cache.get(alert.channelId) as TextChannel;
          if (!channel || !channel.isTextBased()) continue;
          
          // Create alert embed
          const embed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle(`🎬 New Episode Alert!`)
            .setDescription(`**${anime.title}**\nEpisode ${currentEpisodes} is now available!`)
            .setThumbnail(anime.images.jpg.large_image_url)
            .setURL(anime.url)
            .setFooter({ text: 'MyAnimeList' })
            .setTimestamp();
          
          await channel.send({ content: '@everyone', embeds: [embed] });
          
          // Update last episode
          await prisma.animeAlert.update({
            where: { id: alert.id },
            data: { lastEpisode: currentEpisodes },
          });
          
          logger.info({ anime: anime.title, episode: currentEpisodes }, 'Sent anime alert');
        }
        
        // Rate limit: wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        logger.error({ err, alert: alert.animeName }, 'Error checking anime');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in anime checker');
  }
}

