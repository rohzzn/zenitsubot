import type { Client } from 'discord.js';
import { getPrisma } from './db.js';
import { logger } from './logger.js';
import { brandEmbed } from '../utils/ui.js';

/**
 * New anime episodes and game news.
 *
 * Both ride the same shape: a thing a server follows, a source that says what
 * is new, and a high-water mark so a restart does not repost. The sources are
 * chosen for having no API key — AniList is open, and Steam's news endpoint is
 * public — because a feature that needs credentials to register is a feature
 * that stays unconfigured.
 */

const TICK_MS = 10 * 60 * 1000;
const ANILIST_URL = 'https://graphql.anilist.co';
const STEAM_NEWS_URL = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2';

let timer: NodeJS.Timeout | undefined;

// ------------------------------------------------------------------- anime

export interface AnimeMatch {
  id: number;
  title: string;
  coverUrl?: string;
  episodes?: number;
  status?: string;
  nextEpisode?: number;
  airingAt?: number;
}

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;
    return ((await response.json()) as { data: T }).data;
  } catch (err) {
    logger.debug({ err }, 'AniList request failed');
    return null;
  }
}

/** Searches by name, for the autocomplete on /updates anime follow. */
export async function searchAnime(term: string): Promise<AnimeMatch[]> {
  const data = await anilist<{ Page: { media: Array<Record<string, any>> } }>(
    `query ($search: String) {
       Page(perPage: 10) {
         media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
           id
           title { romaji english }
           coverImage { large }
           episodes
           status
           nextAiringEpisode { episode airingAt }
         }
       }
     }`,
    { search: term },
  );

  return (data?.Page.media ?? []).map((media) => ({
    id: media.id,
    title: media.title.english ?? media.title.romaji,
    coverUrl: media.coverImage?.large,
    episodes: media.episodes ?? undefined,
    status: media.status,
    nextEpisode: media.nextAiringEpisode?.episode,
    airingAt: media.nextAiringEpisode?.airingAt,
  }));
}

/**
 * The most recent episode to have actually aired.
 *
 * AniList reports the *next* episode and when it airs, so the last one out is
 * that number minus one — but only once its airing time has passed. Announcing
 * on the schedule rather than on the broadcast would post an episode hours
 * before anyone could watch it.
 */
async function airedEpisode(anilistId: number): Promise<{ episode: number; title: string } | null> {
  const data = await anilist<{ Media: Record<string, any> }>(
    `query ($id: Int) {
       Media(id: $id, type: ANIME) {
         title { romaji english }
         episodes
         status
         nextAiringEpisode { episode airingAt }
       }
     }`,
    { id: anilistId },
  );

  const media = data?.Media;
  if (!media) return null;

  const title = media.title.english ?? media.title.romaji;
  const next = media.nextAiringEpisode;

  if (next) return { episode: Math.max(0, next.episode - 1), title };

  // Finished airing: every episode is out.
  return media.status === 'FINISHED' && media.episodes ? { episode: media.episodes, title } : null;
}

// -------------------------------------------------------------------- games

export interface SteamNews {
  gid: string;
  title: string;
  url: string;
  contents: string;
  author?: string;
  date: number;
}

export async function steamNews(appId: number, count = 3): Promise<SteamNews[]> {
  try {
    const response = await fetch(
      `${STEAM_NEWS_URL}/?appid=${appId}&count=${count}&maxlength=600&format=json`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!response.ok) return [];

    const data = (await response.json()) as {
      appnews?: { newsitems?: SteamNews[] };
    };

    return data.appnews?.newsitems ?? [];
  } catch (err) {
    logger.debug({ err, appId }, 'Steam news request failed');
    return [];
  }
}

/** Looks a game up by name so nobody has to find an app id. */
export async function searchSteamGames(
  term: string,
): Promise<Array<{ appId: number; name: string }>> {
  try {
    const response = await fetch(
      `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(term)}`,
      { signal: AbortSignal.timeout(8000) },
    );

    if (!response.ok) return [];

    const data = (await response.json()) as Array<{ appid: string; name: string }>;
    return data.slice(0, 10).map((app) => ({ appId: Number(app.appid), name: app.name }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- delivery

async function postAnimeUpdates(client: Client): Promise<void> {
  const prisma = getPrisma();
  const follows = await prisma.animeFollow.findMany();

  for (const follow of follows) {
    const settings = await prisma.guildConfig.findUnique({ where: { guildId: follow.guildId } });
    if (!settings?.animeChannelId) continue;

    const aired = await airedEpisode(follow.anilistId);
    if (!aired || aired.episode <= follow.lastEpisode) continue;

    const channel = client.channels.cache.get(settings.animeChannelId);
    if (!channel?.isSendable()) continue;

    const embed = brandEmbed({
      author: { name: 'New episode' },
      title: `${aired.title} — Episode ${aired.episode}`,
      url: `https://anilist.co/anime/${follow.anilistId}`,
      description: `Episode ${aired.episode} has aired.`,
      thumbnail: follow.coverUrl,
      color: 0x02a9ff,
    });

    await channel.send({ embeds: [embed] }).catch(() => {});

    // Written after sending, so a failed post is retried rather than skipped.
    await prisma.animeFollow.update({
      where: { id: follow.id },
      data: { lastEpisode: aired.episode, title: aired.title },
    });
  }
}

async function postGameUpdates(client: Client): Promise<void> {
  const prisma = getPrisma();
  const follows = await prisma.gameFollow.findMany();

  for (const follow of follows) {
    const settings = await prisma.guildConfig.findUnique({ where: { guildId: follow.guildId } });
    if (!settings?.gameChannelId) continue;

    const news = await steamNews(follow.appId, 3);
    if (news.length === 0) continue;

    // Newest first from Steam; anything above the mark is unposted.
    const fresh = follow.lastNewsId
      ? news.slice(
          0,
          news.findIndex((item) => item.gid === follow.lastNewsId),
        )
      : news.slice(0, 1);

    if (fresh.length === 0) continue;

    const channel = client.channels.cache.get(settings.gameChannelId);
    if (!channel?.isSendable()) continue;

    // Oldest first, so a burst reads in the order it happened.
    for (const item of fresh.reverse()) {
      const embed = brandEmbed({
        author: { name: follow.name },
        title: item.title.slice(0, 240),
        url: item.url,
        description: item.contents
          .replace(/\[\/?[^\]]+\]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 400),
        thumbnail: `https://cdn.cloudflare.steamstatic.com/steam/apps/${follow.appId}/capsule_231x87.jpg`,
        color: 0x1b2838,
      });

      await channel.send({ embeds: [embed] }).catch(() => {});
    }

    await prisma.gameFollow.update({
      where: { id: follow.id },
      data: { lastNewsId: news[0]!.gid },
    });
  }
}

async function tick(client: Client): Promise<void> {
  try {
    await postAnimeUpdates(client);
    await postGameUpdates(client);
  } catch (err) {
    logger.error({ err }, 'Update scheduler tick failed');
  }
}

export function startUpdateScheduler(client: Client): void {
  if (timer) return;

  timer = setInterval(() => void tick(client), TICK_MS);
  timer.unref();

  void tick(client);
  logger.info('Update scheduler started');
}
