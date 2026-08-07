/**
 * One shape for every torrent index the bot can search.
 *
 * The indexes differ enormously — 1337x is HTML that has to be scraped in two
 * steps, The Pirate Bay is a JSON endpoint, Nyaa is an RSS feed — but what a
 * person wants out of them is identical. Everything below this line speaks
 * this type, so adding a source is writing one adapter rather than touching
 * the search, ranking or display code.
 */

export type SourceId = '1337x' | 'piratebay' | 'nyaa' | 'solidtorrents' | 'fitgirl';

/** The categories a search can be narrowed to, mapped per source. */
export type SourceCategory =
  | 'Movies'
  | 'TV'
  | 'Games'
  | 'Music'
  | 'Apps'
  | 'Anime'
  | 'Documentaries'
  | 'Other'
  | 'XXX';

export interface SourceResult {
  source: SourceId;
  /** Unique within its source, not across them. */
  id: string;
  title: string;
  pageUrl: string;
  /**
   * Present when the index hands out the hash directly, which most JSON and
   * RSS sources do. It is what lets a result be opened without a second
   * request — only 1337x needs its page scraped.
   */
  infoHash?: string;
  magnet?: string;
  category?: string;
  type?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  downloads?: number;
  uploadedAt?: string;
  uploader?: string;
  trusted?: boolean;
}

export interface SourceSearchOptions {
  query: string;
  category?: string;
  limit: number;
  /**
   * "recent" asks for the newest uploads rather than the most popular. Only
   * 1337x needs telling — the others already answer newest-first or have no
   * ordering worth overriding — but a watch waiting for a release that does
   * not exist yet has to see new rows, not well-seeded old ones.
   */
  sort?: 'relevance' | 'recent';
}

export interface TorrentSource {
  id: SourceId;
  label: string;
  /** Shown in the picker so people know what a source is good for. */
  blurb: string;
  /**
   * Categories this source can answer. A source is skipped rather than asked
   * a question it cannot answer — Nyaa has nothing but anime.
   */
  categories: SourceCategory[] | 'all';
  /**
   * Whether a plain search asks this source without being told to.
   *
   * The two broad general indexes carry an ordinary search on their own;
   * anything specialised is there when you want it and out of the way when you
   * do not, because every extra source is another request and more noise in a
   * list that is already long enough.
   */
  enabledByDefault: boolean;
  search(options: SourceSearchOptions): Promise<SourceResult[]>;
}

/** Public trackers used to build a magnet from a bare infohash. */
export const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
];

/**
 * A magnet for a result that only came with a hash.
 *
 * The trackers matter: a magnet with no announce list relies entirely on the
 * DHT, which is slow to bootstrap and blocked on plenty of networks.
 */
export function magnetFromHash(infoHash: string, name: string): string {
  const params = new URLSearchParams();
  params.set('dn', name);
  for (const tracker of PUBLIC_TRACKERS) params.append('tr', tracker);

  return `magnet:?xt=urn:btih:${infoHash.toUpperCase()}&${params}`;
}
