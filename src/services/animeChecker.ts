import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { getPrisma } from './db.js';
import { logger } from './logger.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
// Jikan asks for no more than ~3 requests/second; we are far more conservative.
const REQUEST_SPACING_MS = 1500;

interface JikanEpisode {
  mal_id: number;
  title?: string;
  aired?: string | null;
}

interface JikanAnime {
  mal_id: number;
  title: string;
  url: string;
  images?: { jpg?: { large_image_url?: string } };
}

export function startAnimeChecker(client: Client) {
  setInterval(() => void checkForNewEpisodes(client), CHECK_INTERVAL_MS);
  setTimeout(() => void checkForNewEpisodes(client), FIRST_CHECK_DELAY_MS);
  logger.info('Anime episode checker started');
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Jikan request failed');
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    logger.warn({ err, url }, 'Jikan request threw');
    return null;
  }
}

/**
 * Returns the highest episode number that has actually aired.
 *
 * The anime record's own `episodes` field is the *planned* total for the whole
 * series, so it is useless for detecting weekly releases — it is either null
 * while a show airs, or already at the final count. The episodes endpoint is
 * paginated oldest-first and only lists episodes once they exist.
 */
export async function fetchLatestAiredEpisode(malId: string): Promise<number> {
  const data = await fetchJson<{
    data?: JikanEpisode[];
    pagination?: { last_visible_page?: number };
  }>(`https://api.jikan.moe/v4/anime/${malId}/episodes`);
  if (!data?.data) return 0;

  const lastPage = data.pagination?.last_visible_page ?? 1;
  let episodes = data.data;

  if (lastPage > 1) {
    await sleep(REQUEST_SPACING_MS);
    const tail = await fetchJson<{ data?: JikanEpisode[] }>(
      `https://api.jikan.moe/v4/anime/${malId}/episodes?page=${lastPage}`,
    );
    if (tail?.data?.length) episodes = tail.data;
  }

  const aired = episodes.filter((ep) => ep.aired && new Date(ep.aired).getTime() <= Date.now());
  return aired.reduce((max, ep) => Math.max(max, ep.mal_id), 0);
}

async function checkForNewEpisodes(client: Client) {
  const prisma = getPrisma();

  try {
    const alerts = await prisma.animeAlert.findMany();

    for (const alert of alerts) {
      try {
        const latestEpisode = await fetchLatestAiredEpisode(alert.animeId);
        if (latestEpisode <= alert.lastEpisode) {
          await sleep(REQUEST_SPACING_MS);
          continue;
        }

        const guild = client.guilds.cache.get(alert.guildId);
        const channel = guild?.channels.cache.get(alert.channelId) as TextChannel | undefined;

        // Record progress even when we can no longer reach the channel, so a
        // deleted channel does not make us re-check the same episode forever.
        if (!channel?.isTextBased()) {
          await prisma.animeAlert.update({
            where: { id: alert.id },
            data: { lastEpisode: latestEpisode },
          });
          continue;
        }

        await sleep(REQUEST_SPACING_MS);
        const details = await fetchJson<{ data?: JikanAnime }>(
          `https://api.jikan.moe/v4/anime/${alert.animeId}`,
        );
        const anime = details?.data;

        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('New Episode Alert')
          .setDescription(
            `**${anime?.title ?? alert.animeName}**\nEpisode ${latestEpisode} is now available!`,
          )
          .setFooter({ text: 'MyAnimeList' })
          .setTimestamp();

        if (anime?.url) embed.setURL(anime.url);
        const thumbnail = anime?.images?.jpg?.large_image_url;
        if (thumbnail) embed.setThumbnail(thumbnail);

        // Ping only the person who set the alert up — never @everyone. Alerts
        // created before userId existed are backfilled blank, so guard on it.
        await channel.send({
          content: alert.userId ? `<@${alert.userId}>` : undefined,
          embeds: [embed],
          allowedMentions: alert.userId ? { users: [alert.userId] } : { parse: [] },
        });

        await prisma.animeAlert.update({
          where: { id: alert.id },
          data: { lastEpisode: latestEpisode },
        });

        logger.info({ anime: alert.animeName, episode: latestEpisode }, 'Sent anime alert');
        await sleep(REQUEST_SPACING_MS);
      } catch (err) {
        logger.error({ err, alert: alert.animeName }, 'Error checking anime');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in anime checker');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
