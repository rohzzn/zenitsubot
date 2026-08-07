import type { ParsedRelease } from './releaseName.js';

/**
 * Scoring a torrent by how good a download it actually is.
 *
 * Seeder count alone is a poor answer: it rewards whatever has been around
 * longest, so a 2019 720p re-encode outranks this week's 2160p remux, and a
 * camera rip of a new film outranks everything because it got there first.
 * The score blends how fast it will download with how good it will look, and
 * treats a cam rip as close to worthless however many seeders it has.
 *
 * Deliberately deterministic and free of I/O so the weights can be tested.
 */

export interface RankInput {
  seeders?: number;
  leechers?: number;
  sizeBytes?: number;
  trusted?: boolean;
  release: ParsedRelease;
}

/**
 * 0 at no seeders, 1 around ten thousand; the curve flattens where it should.
 *
 * A source that does not report seeders at all is a different thing from one
 * reporting zero, and scoring it as dead would bury every result from an index
 * that simply does not publish the number.
 */
function health(seeders: number | undefined): number {
  if (seeders === undefined) return 0.45;
  if (seeders <= 0) return 0;
  return Math.min(1, Math.log10(seeders + 1) / 4);
}

const RESOLUTION_SCORE: Record<string, number> = {
  '2160p': 1,
  '1440p': 0.9,
  '1080p': 0.85,
  '720p': 0.6,
  '480p': 0.3,
};

const SOURCE_SCORE: Record<string, number> = {
  REMUX: 1,
  BluRay: 0.95,
  'WEB-DL': 0.9,
  WEBRip: 0.75,
  WEB: 0.72,
  HDTV: 0.55,
  HDRip: 0.5,
  DVDRip: 0.35,
  SCR: 0.1,
  TS: 0.05,
  CAM: 0.02,
};

/**
 * Sizes below which a release is a heavy re-encode rather than what its
 * resolution claims. Only applied to feature-length items — an episode is
 * legitimately small.
 */
const MIN_PLAUSIBLE_BYTES: Record<string, number> = {
  '2160p': 3 * 1024 ** 3,
  '1080p': 800 * 1024 ** 2,
  '720p': 400 * 1024 ** 2,
};

/** An unknown field scores mid rather than bottom: absent is not the same as bad. */
const UNKNOWN = 0.5;

export function scoreRelease(input: RankInput): number {
  const { release } = input;

  const resolution = release.resolution
    ? (RESOLUTION_SCORE[release.resolution] ?? UNKNOWN)
    : UNKNOWN;
  const source = release.source ? (SOURCE_SCORE[release.source] ?? UNKNOWN) : UNKNOWN;

  let quality = resolution * 0.6 + source * 0.4;

  // An overcompressed encode is not the resolution it advertises.
  const floor = release.resolution ? MIN_PLAUSIBLE_BYTES[release.resolution] : undefined;
  const isEpisode = release.episode !== undefined;
  if (floor && !isEpisode && input.sizeBytes !== undefined && input.sizeBytes < floor) {
    quality *= 0.75;
  }

  let score = health(input.seeders) * 0.5 + quality * 0.5;

  // A cam or telesync is a different product, not a slightly worse one.
  if (release.lowQuality) score *= 0.3;

  if (input.trusted) score += 0.04;
  if (release.repack) score += 0.02;
  if (release.hdr) score += 0.02;

  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 10;
}

/** Highest score first; ties keep the order they arrived in. */
export function rankByScore<T extends RankInput>(entries: T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: scoreRelease(entry) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((scored) => scored.entry);
}
