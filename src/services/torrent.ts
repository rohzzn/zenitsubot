import crypto from 'node:crypto';
import { logger } from './logger.js';

/**
 * Torrent search and magnet handling over sources that distribute their
 * content legally: the Internet Archive, and the Linux distributions that
 * publish official images over BitTorrent.
 */

const IA_SEARCH = 'https://archive.org/advancedsearch.php';
const IA_DOWNLOAD = 'https://archive.org/download';
const TIMEOUT_MS = 20_000;

/** Trackers the Internet Archive itself announces on. */
const IA_TRACKERS = [
  'http://bt1.archive.org:6969/announce',
  'http://bt2.archive.org:6969/announce',
];

export class TorrentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorrentError';
  }
}

export interface TorrentResult {
  identifier: string;
  title: string;
  mediatype?: string;
  creator?: string;
  year?: string;
  downloads?: number;
  size?: number;
  pageUrl: string;
  torrentUrl: string;
}

export interface TorrentDetails {
  name: string;
  infoHash: string;
  magnet: string;
  totalBytes: number;
  fileCount: number;
  files: Array<{ path: string; bytes: number }>;
  trackers: string[];
  pieceLength?: number;
  createdBy?: string;
  comment?: string;
}

// -------------------------------------------------------------- bencode

type Bencoded = Buffer | number | Bencoded[] | { [key: string]: Bencoded };

interface DecodeResult {
  value: Bencoded;
  /** Byte range of the raw info dictionary, needed for a correct infohash. */
  infoStart: number;
  infoEnd: number;
}

/**
 * Decodes bencode, recording where the info dictionary sits in the original
 * buffer. The infohash must be SHA-1 over those exact bytes: re-encoding the
 * parsed structure can reorder keys and produce a hash that matches nothing.
 */
export function decodeBencode(buf: Buffer): DecodeResult {
  let pos = 0;
  let infoStart = -1;
  let infoEnd = -1;

  function parse(): Bencoded {
    const marker = buf[pos];

    if (marker === 0x69) {
      // i<number>e
      pos++;
      const end = buf.indexOf(0x65, pos);
      if (end === -1) throw new TorrentError('Malformed torrent data.');
      const value = Number(buf.subarray(pos, end).toString('latin1'));
      pos = end + 1;
      return value;
    }

    if (marker === 0x6c) {
      // l...e
      pos++;
      const list: Bencoded[] = [];
      while (buf[pos] !== 0x65) {
        if (pos >= buf.length) throw new TorrentError('Malformed torrent data.');
        list.push(parse());
      }
      pos++;
      return list;
    }

    if (marker === 0x64) {
      // d...e
      pos++;
      const dict: { [key: string]: Bencoded } = {};
      while (buf[pos] !== 0x65) {
        if (pos >= buf.length) throw new TorrentError('Malformed torrent data.');
        const key = (parse() as Buffer).toString('latin1');
        if (key === 'info') infoStart = pos;
        dict[key] = parse();
        if (key === 'info') infoEnd = pos;
      }
      pos++;
      return dict;
    }

    // <length>:<bytes>
    const colon = buf.indexOf(0x3a, pos);
    if (colon === -1) throw new TorrentError('Malformed torrent data.');
    const length = Number(buf.subarray(pos, colon).toString('latin1'));
    if (!Number.isFinite(length) || length < 0) throw new TorrentError('Malformed torrent data.');
    const start = colon + 1;
    pos = start + length;
    return buf.subarray(start, pos);
  }

  const value = parse();
  return { value, infoStart, infoEnd };
}

function asString(value: Bencoded | undefined): string | undefined {
  return Buffer.isBuffer(value) ? value.toString('utf8') : undefined;
}

/** Parses a .torrent file into the details a magnet needs. */
export function parseTorrent(buf: Buffer): TorrentDetails {
  const { value, infoStart, infoEnd } = decodeBencode(buf);

  if (typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) {
    throw new TorrentError('That is not a torrent file.');
  }
  if (infoStart < 0 || infoEnd <= infoStart) {
    throw new TorrentError('Torrent is missing its info dictionary.');
  }

  const root = value as Record<string, Bencoded>;
  const info = root.info as Record<string, Bencoded> | undefined;
  if (!info) throw new TorrentError('Torrent is missing its info dictionary.');

  const infoHash = crypto.createHash('sha1').update(buf.subarray(infoStart, infoEnd)).digest('hex');

  const name = asString(info.name) ?? 'unknown';

  const files: Array<{ path: string; bytes: number }> = [];
  let totalBytes = 0;

  if (Array.isArray(info.files)) {
    for (const entry of info.files as Array<Record<string, Bencoded>>) {
      const segments = (entry.path as Buffer[] | undefined) ?? [];
      const path = segments.map((s) => s.toString('utf8')).join('/');
      const bytes = typeof entry.length === 'number' ? entry.length : 0;
      files.push({ path, bytes });
      totalBytes += bytes;
    }
  } else if (typeof info.length === 'number') {
    files.push({ path: name, bytes: info.length });
    totalBytes = info.length;
  }

  const trackers = new Set<string>();
  const announce = asString(root.announce);
  if (announce) trackers.add(announce);

  if (Array.isArray(root['announce-list'])) {
    for (const tier of root['announce-list'] as Bencoded[]) {
      if (!Array.isArray(tier)) continue;
      for (const entry of tier) {
        const url = asString(entry);
        if (url) trackers.add(url);
      }
    }
  }

  const params = new URLSearchParams();
  params.set('dn', name);
  for (const tracker of trackers) params.append('tr', tracker);

  return {
    name,
    infoHash,
    magnet: `magnet:?xt=urn:btih:${infoHash}&${params}`,
    totalBytes,
    fileCount: files.length,
    files,
    trackers: [...trackers],
    pieceLength: typeof info['piece length'] === 'number' ? info['piece length'] : undefined,
    createdBy: asString(root['created by']),
    comment: asString(root.comment),
  };
}

export interface ParsedMagnet {
  infoHash: string;
  name?: string;
  trackers: string[];
  sizeBytes?: number;
  webSeeds: string[];
  raw: string;
}

/** Reads a magnet URI without contacting anything. */
export function parseMagnet(input: string): ParsedMagnet {
  const text = input.trim();
  if (!text.toLowerCase().startsWith('magnet:')) {
    throw new TorrentError('That is not a magnet link.');
  }

  const params = new URLSearchParams(text.slice(text.indexOf('?') + 1));
  const xts = params.getAll('xt');

  // btih is the BitTorrent v1 infohash: 40 hex chars, or 32 base32.
  const btih = xts.find((x) => x.toLowerCase().startsWith('urn:btih:'));
  if (!btih) throw new TorrentError('Magnet has no BitTorrent infohash (xt=urn:btih:).');

  let hash = btih.slice('urn:btih:'.length).trim();

  if (/^[a-z2-7]{32}$/i.test(hash)) {
    // Base32 encoded; convert to the usual hex form.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const char of hash.toUpperCase()) {
      const index = alphabet.indexOf(char);
      if (index === -1) throw new TorrentError('Magnet infohash is not valid base32.');
      bits += index.toString(2).padStart(5, '0');
    }
    hash = (bits.match(/.{8}/g) ?? [])
      .map((byte) => parseInt(byte, 2).toString(16).padStart(2, '0'))
      .join('');
  }

  if (!/^[a-f0-9]{40}$/i.test(hash)) {
    throw new TorrentError('Magnet infohash is not a valid 40-character hex value.');
  }

  const size = params.get('xl');

  return {
    infoHash: hash.toLowerCase(),
    name: params.get('dn') ?? undefined,
    trackers: params.getAll('tr'),
    sizeBytes: size ? Number(size) : undefined,
    webSeeds: params.getAll('ws'),
    raw: text,
  };
}

// --------------------------------------------------- Internet Archive

interface IaDoc {
  identifier: string;
  title?: string | string[];
  mediatype?: string;
  creator?: string | string[];
  year?: string;
  downloads?: number;
  item_size?: number;
}

function first(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function searchArchive(query: string, limit = 8): Promise<TorrentResult[]> {
  const params = new URLSearchParams({
    q: query,
    rows: String(limit),
    page: '1',
    output: 'json',
    sort: 'downloads desc',
  });
  for (const field of [
    'identifier',
    'title',
    'mediatype',
    'creator',
    'year',
    'downloads',
    'item_size',
  ]) {
    params.append('fl[]', field);
  }

  try {
    const response = await fetch(`${IA_SEARCH}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) throw new TorrentError(`Archive search returned ${response.status}.`);

    const data = (await response.json()) as { response?: { docs?: IaDoc[] } };

    return (data.response?.docs ?? []).map((doc) => ({
      identifier: doc.identifier,
      title: first(doc.title) ?? doc.identifier,
      mediatype: doc.mediatype,
      creator: first(doc.creator),
      year: doc.year,
      downloads: doc.downloads,
      size: doc.item_size,
      pageUrl: `https://archive.org/details/${doc.identifier}`,
      torrentUrl: `${IA_DOWNLOAD}/${doc.identifier}/${doc.identifier}_archive.torrent`,
    }));
  } catch (err) {
    if (err instanceof TorrentError) throw err;
    logger.warn({ err, query }, 'Archive search failed');
    throw new TorrentError('Could not reach the Internet Archive.');
  }
}

/** Downloads an item's .torrent and derives its magnet. */
export async function magnetForArchiveItem(result: TorrentResult): Promise<TorrentDetails> {
  try {
    const response = await fetch(result.torrentUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new TorrentError(
        response.status === 404
          ? 'That item has no torrent. Very small or restricted items sometimes do not.'
          : `Archive returned ${response.status} for that torrent.`,
      );
    }

    const details = parseTorrent(Buffer.from(await response.arrayBuffer()));

    // The Archive's own trackers are not always in the file itself.
    const trackers = new Set([...details.trackers, ...IA_TRACKERS]);
    const params = new URLSearchParams();
    params.set('dn', details.name);
    for (const tracker of trackers) params.append('tr', tracker);

    return {
      ...details,
      trackers: [...trackers],
      magnet: `magnet:?xt=urn:btih:${details.infoHash}&${params}`,
    };
  } catch (err) {
    if (err instanceof TorrentError) throw err;
    logger.warn({ err, item: result.identifier }, 'Archive torrent fetch failed');
    throw new TorrentError('Could not fetch that torrent.');
  }
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes < 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
