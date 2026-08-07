import { fetchJson } from './http.js';
import { magnetFromHash, type SourceResult, type TorrentSource } from './types.js';

/**
 * The Pirate Bay, through the JSON endpoint its own front end uses.
 *
 * The broadest index available without scraping anything: films, television,
 * music, applications and — the reason it earns its place here — games, which
 * 1337x covers thinly. Every row carries its infohash, so a result can be
 * opened without a second request.
 */

const API = 'https://apibay.org';

/** TPB's numeric categories. 0 searches everything. */
const CATEGORY_IDS: Record<string, number> = {
  Movies: 200,
  TV: 205,
  Documentaries: 200,
  Music: 100,
  Apps: 300,
  Games: 400,
  Other: 0,
};

/** Enough of the sub-category table to label a row usefully. */
const CATEGORY_LABELS: Record<number, string> = {
  101: 'Music',
  102: 'Audio books',
  103: 'Sound clips',
  104: 'FLAC',
  199: 'Audio',
  201: 'Movies',
  202: 'Movies DVDR',
  203: 'Music videos',
  204: 'Movie clips',
  205: 'TV',
  206: 'Handheld',
  207: 'Movies HD',
  208: 'TV HD',
  209: 'Movies 3D',
  299: 'Video',
  301: 'Windows',
  302: 'Mac',
  303: 'UNIX',
  304: 'Handheld apps',
  305: 'iOS apps',
  306: 'Android apps',
  399: 'Apps',
  401: 'PC games',
  402: 'Mac games',
  403: 'PSx games',
  404: 'XBOX360 games',
  405: 'Wii games',
  406: 'Handheld games',
  407: 'iOS games',
  408: 'Android games',
  499: 'Games',
  601: 'E-books',
  602: 'Comics',
  603: 'Pictures',
  604: 'Covers',
  605: 'Physibles',
  699: 'Other',
};

/** The broad category a numeric id belongs to. */
function topLevel(category: number): string | undefined {
  if (category >= 100 && category < 200) return 'Music';
  if (category >= 200 && category < 300)
    return category === 205 || category === 208 ? 'TV' : 'Movies';
  if (category >= 300 && category < 400) return 'Apps';
  if (category >= 400 && category < 500) return 'Games';
  if (category >= 500 && category < 600) return 'XXX';
  return 'Other';
}

interface ApibayRow {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  size: string;
  num_files: string;
  username: string;
  added: string;
  status: string;
  category: string;
  imdb?: string;
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parsePirateBay(rows: ApibayRow[]): SourceResult[] {
  return rows
    .filter(
      (row) =>
        // An empty search answers with a single sentinel row rather than [].
        row.id !== '0' &&
        row.name !== 'No results returned' &&
        /^[a-f0-9]{40}$/i.test(row.info_hash ?? ''),
    )
    .map((row) => {
      const category = toNumber(row.category) ?? 0;
      const added = toNumber(row.added);

      return {
        source: 'piratebay' as const,
        id: row.id,
        title: row.name,
        pageUrl: `https://thepiratebay.org/description.php?id=${row.id}`,
        infoHash: row.info_hash.toUpperCase(),
        magnet: magnetFromHash(row.info_hash, row.name),
        category: topLevel(category),
        type: CATEGORY_LABELS[category],
        sizeBytes: toNumber(row.size),
        seeders: toNumber(row.seeders),
        leechers: toNumber(row.leechers),
        uploadedAt: added ? new Date(added * 1000).toISOString() : undefined,
        uploader: row.username || undefined,
        // TPB marks its long-standing uploaders, which is the same signal
        // 1337x's verified badge carries.
        trusted: row.status === 'vip' || row.status === 'trusted',
      };
    });
}

export const pirateBaySource: TorrentSource = {
  id: 'piratebay',
  label: 'The Pirate Bay',
  blurb: 'Broadest index — films, TV, music, apps and games',
  categories: 'all',
  enabledByDefault: true,

  async search({ query, category, limit }) {
    const id = category ? CATEGORY_IDS[category] : 0;
    // A category this source cannot express is better ignored than guessed at.
    const params = new URLSearchParams({ q: query, cat: String(id ?? 0) });

    const rows = await fetchJson<ApibayRow[]>('piratebay', `${API}/q.php?${params}`);
    return Array.isArray(rows) ? parsePirateBay(rows).slice(0, limit) : [];
  },
};
