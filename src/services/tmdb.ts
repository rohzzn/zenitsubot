import { logger } from './logger.js';

/**
 * Film and show metadata from TMDb, used to turn a release name into something
 * a person can judge.
 *
 * "The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir" tells you about the
 * encode and nothing about the film. A poster, a plot and a rating answer the
 * question actually being asked, which is "is this the thing I wanted".
 *
 * Never load-bearing: every failure returns null and the card renders without
 * it, so a missing key or a TMDb outage cannot break `/torrent`.
 */

const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w500';
const TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

export interface TmdbInfo {
  title: string;
  year?: number;
  overview?: string;
  posterUrl?: string;
  /** TMDb's 0-10 average, rounded to one decimal. */
  rating?: number;
  votes?: number;
  genres?: string[];
  tmdbUrl: string;
}

export function tmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY);
}

interface CacheEntry {
  expires: number;
  value: TmdbInfo | null;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): { hit: boolean; value: TmdbInfo | null } {
  const entry = cache.get(key);
  if (!entry) return { hit: false, value: null };
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value };
}

function cacheSet(key: string, value: TmdbInfo | null): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
}

export function clearTmdbCache(): void {
  cache.clear();
}

/** TMDb keeps films and shows in separate collections with different fields. */
export type TmdbKind = 'movie' | 'tv';

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
}

/**
 * TMDb returns genres as ids from search, and resolving them needs a second
 * request per language. The list is small and changes rarely, so it is held
 * here rather than fetched on every lookup.
 */
const GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
};

function shape(result: TmdbResult, kind: TmdbKind): TmdbInfo {
  const date = result.release_date ?? result.first_air_date;
  const year = date ? Number(date.slice(0, 4)) : undefined;

  return {
    title: result.title ?? result.name ?? 'Unknown',
    year: Number.isFinite(year) ? year : undefined,
    overview: result.overview?.trim() || undefined,
    posterUrl: result.poster_path ? `${IMAGE}${result.poster_path}` : undefined,
    rating:
      typeof result.vote_average === 'number' && result.vote_average > 0
        ? Math.round(result.vote_average * 10) / 10
        : undefined,
    votes: result.vote_count,
    genres: (result.genre_ids ?? [])
      .map((id) => GENRES[id])
      .filter((name): name is string => Boolean(name)),
    tmdbUrl: `https://www.themoviedb.org/${kind}/${result.id}`,
  };
}

async function search(
  kind: TmdbKind,
  title: string,
  year: number | undefined,
): Promise<TmdbResult | null> {
  const params = new URLSearchParams({
    api_key: process.env.TMDB_API_KEY ?? '',
    query: title,
    include_adult: 'false',
    language: 'en-US',
  });

  // TMDb names the year parameter differently per collection.
  if (year)
    params.set(kind === 'movie' ? 'primary_release_year' : 'first_air_date_year', String(year));

  const response = await fetch(`${API}/search/${kind}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`TMDb returned ${response.status}`);

  const data = (await response.json()) as { results?: TmdbResult[] };
  return data.results?.[0] ?? null;
}

/**
 * Looks a title up, preferring the collection the release looks like it came
 * from but falling back to the other — 1337x categories are not reliable
 * enough to trust on their own.
 */
export async function lookupTitle(
  title: string,
  options: { year?: number; kind?: TmdbKind } = {},
): Promise<TmdbInfo | null> {
  const cleaned = title.trim();
  if (!tmdbConfigured() || cleaned.length < 2) return null;

  const key = `${options.kind ?? 'any'}:${cleaned.toLowerCase()}:${options.year ?? ''}`;
  const cached = cacheGet(key);
  if (cached.hit) return cached.value;

  const order: TmdbKind[] = options.kind === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];

  try {
    for (const kind of order) {
      // The year narrows a common title to the right one; without a hit, try
      // again without it rather than reporting nothing.
      const found =
        (await search(kind, cleaned, options.year)) ?? (await search(kind, cleaned, undefined));
      if (found) {
        const info = shape(found, kind);
        cacheSet(key, info);
        return info;
      }
    }

    cacheSet(key, null);
    return null;
  } catch (err) {
    logger.debug({ err, title: cleaned }, 'TMDb lookup failed');
    // Not cached: a transient outage should not suppress the poster for a day.
    return null;
  }
}
