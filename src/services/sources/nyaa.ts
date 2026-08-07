import { fetchText } from './http.js';
import { parseSizeToBytes } from '../1337xParse.js';
import { magnetFromHash, type SourceResult, type TorrentSource } from './types.js';

/**
 * Nyaa, through its RSS feed.
 *
 * Anime is the one thing the general indexes are consistently bad at — fansub
 * groups, batches and alternate translations barely appear on them. Nyaa's
 * feed carries the infohash, seeders, size and its trusted flag, so a search
 * needs exactly one request and no page scraping at all.
 */

const BASE = 'https://nyaa.si';

/** Everything on Nyaa is anime; other categories are simply not its job. */
const ANIME_CATEGORY = '1_0';

function tag(item: string, name: string): string | undefined {
  // The tag name has to end where it ends: a loose `[^>]*` would let
  // <nyaa:category> match <nyaa:categoryId> and swallow everything between.
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(item);
  if (!match) return undefined;

  return match[1]!
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

export function parseNyaa(xml: string): SourceResult[] {
  const results: SourceResult[] = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1]!;

    const title = tag(item, 'title');
    const infoHash = tag(item, 'nyaa:infoHash');
    if (!title || !infoHash || !/^[a-f0-9]{40}$/i.test(infoHash)) continue;

    const view = tag(item, 'guid');
    const id = /\/view\/(\d+)/.exec(view ?? '')?.[1];
    const published = tag(item, 'pubDate');
    const timestamp = published ? Date.parse(published) : NaN;

    results.push({
      source: 'nyaa',
      id: id ?? infoHash,
      title,
      pageUrl: view ?? `${BASE}/view/${id ?? ''}`,
      infoHash: infoHash.toUpperCase(),
      magnet: magnetFromHash(infoHash, title),
      category: 'Anime',
      // "Anime - English-translated" is more use than the bare category id.
      type: tag(item, 'nyaa:category')?.replace(/^Anime\s*-\s*/, ''),
      // Nyaa reports sizes with binary units already, e.g. "1.4 GiB".
      sizeBytes: parseSizeToBytes(tag(item, 'nyaa:size')),
      seeders: Number(tag(item, 'nyaa:seeders')) || 0,
      leechers: Number(tag(item, 'nyaa:leechers')) || 0,
      downloads: Number(tag(item, 'nyaa:downloads')) || undefined,
      uploadedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined,
      trusted: tag(item, 'nyaa:trusted')?.toLowerCase() === 'yes',
    });
  }

  return results;
}

export const nyaaSource: TorrentSource = {
  id: 'nyaa',
  label: 'Nyaa',
  blurb: 'Anime, including fansubs and batches the big indexes miss',
  categories: ['Anime'],
  enabledByDefault: false,

  async search({ query, limit }) {
    const params = new URLSearchParams({
      page: 'rss',
      q: query,
      c: ANIME_CATEGORY,
      // 0 is "no filter"; the alternatives hide everything but trusted uploads.
      f: '0',
    });

    const xml = await fetchText('nyaa', `${BASE}/?${params}`, 'application/rss+xml,text/xml');
    return parseNyaa(xml).slice(0, limit);
  },
};
