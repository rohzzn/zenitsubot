import { fetchJson } from './http.js';
import { magnetFromHash, type SourceResult, type TorrentSource } from './types.js';

/**
 * SolidTorrents, through its public JSON search.
 *
 * A DHT-backed index rather than a curated tracker, so it turns up material
 * that was never posted to a site at all. Useful as breadth behind the others
 * rather than as a first stop — its metadata is thinner and its ordering is
 * its own.
 */

const API = 'https://solidtorrents.to/api/v1';

interface SolidRow {
  id?: string;
  infohash?: string;
  title?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  downloads?: number;
  verified?: boolean;
  updatedAt?: string;
}

export function parseSolidTorrents(rows: SolidRow[]): SourceResult[] {
  return rows
    .filter((row) => row.title && /^[a-f0-9]{40}$/i.test(row.infohash ?? ''))
    .map((row) => {
      const hash = row.infohash!.toUpperCase();
      return {
        source: 'solidtorrents' as const,
        id: row.id ?? hash,
        title: row.title!,
        pageUrl: `https://solidtorrents.to/torrents/${row.id ?? hash}`,
        infoHash: hash,
        magnet: magnetFromHash(hash, row.title!),
        sizeBytes: typeof row.size === 'number' && row.size > 0 ? row.size : undefined,
        seeders: typeof row.seeders === 'number' ? row.seeders : undefined,
        leechers: typeof row.leechers === 'number' ? row.leechers : undefined,
        downloads:
          typeof row.downloads === 'number' && row.downloads > 0 ? row.downloads : undefined,
        // `updatedAt` is when the index last saw the swarm, not when the
        // torrent was created, so there is no upload date to report.
        uploadedAt: undefined,
        trusted: row.verified === true,
      };
    });
}

export const solidTorrentsSource: TorrentSource = {
  id: 'solidtorrents',
  label: 'SolidTorrents',
  blurb: 'DHT index — finds material never posted to a tracker site',
  categories: 'all',
  enabledByDefault: false,

  async search({ query, limit }) {
    const params = new URLSearchParams({ q: query, sort: 'seeders' });

    const data = await fetchJson<{ results?: SolidRow[] }>(
      'solidtorrents',
      `${API}/search?${params}`,
    );

    return parseSolidTorrents(data.results ?? []).slice(0, limit);
  },
};
