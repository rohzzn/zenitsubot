/**
 * Scene/P2P release-name parsing.
 *
 * Release names are far more structured than they look —
 * `Show.Name.S01E05.1080p.WEB-DL.DDP5.1.x265-GROUP` carries the resolution,
 * source, audio, codec, episode and group in fixed vocabulary. Pulling those
 * out is what lets the bot show a quality line, offer filters that mean
 * something, and warn about a camera rip.
 *
 * Deliberately deterministic: no model call, no network, so it costs nothing
 * per search and can be tested exhaustively.
 */

export interface ParsedRelease {
  /** 2160p, 1080p, 720p, 480p. */
  resolution?: string;
  /** BluRay, REMUX, WEB-DL, WEBRip, HDTV, DVDRip, HDRip, CAM, TS, SCR. */
  source?: string;
  /** x265, x264, AV1, XviD. */
  codec?: string;
  audio?: string;
  hdr?: string;
  season?: number;
  episode?: number;
  /** A whole season or a multi-season pack rather than one episode. */
  completePack?: boolean;
  year?: number;
  group?: string;
  repack?: boolean;
  /** Cam, telesync or screener — worth warning about. */
  lowQuality?: boolean;
}

/** Dots, underscores and brackets are separators in a release name. */
function normalise(title: string): string {
  return ` ${title
    .replace(/[._[\]()+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

interface Rule {
  label: string;
  pattern: RegExp;
}

/** First match wins, so the more specific spelling has to come first. */
function firstMatch(haystack: string, rules: Rule[]): string | undefined {
  for (const { label, pattern } of rules) {
    if (pattern.test(haystack)) return label;
  }
  return undefined;
}

const RESOLUTIONS: Rule[] = [
  { label: '2160p', pattern: /\b(2160p|4k|uhd)\b/i },
  { label: '1440p', pattern: /\b1440p\b/i },
  { label: '1080p', pattern: /\b(1080p|1080i|fullhd)\b/i },
  { label: '720p', pattern: /\b720p\b/i },
  { label: '480p', pattern: /\b(480p|576p|sd)\b/i },
];

// `normalise` turns dots and underscores into spaces but leaves hyphens alone,
// because a hyphen is how a release signs its group. So every multi-word token
// has to tolerate a space or a hyphen between its parts: WEB-DL and WEB.DL are
// the same source, and matching the bare "WEB" rule first would lose the DL.
const SOURCES: Rule[] = [
  { label: 'REMUX', pattern: /\bremux\b/i },
  { label: 'CAM', pattern: /\b(cam|camrip|hdcam)\b/i },
  { label: 'TS', pattern: /\b(ts|telesync|hdts|telecine|tc)\b/i },
  { label: 'SCR', pattern: /\b(scr|screener|dvdscr|bdscr)\b/i },
  { label: 'BluRay', pattern: /\b(blu[ -]?ray|bdrip|br[ -]?rip|bdr|bd25|bd50)\b/i },
  { label: 'WEB-DL', pattern: /\bweb[ -]?dl\b/i },
  { label: 'WEBRip', pattern: /\bweb[ -]?rip\b/i },
  { label: 'WEB', pattern: /\bweb\b/i },
  { label: 'HDTV', pattern: /\b(hdtv|pdtv|dsr)\b/i },
  { label: 'HDRip', pattern: /\bhd[ -]?rip\b/i },
  { label: 'DVDRip', pattern: /\b(dvd[ -]?rip|dvd5|dvd9|dvd)\b/i },
];

const CODECS: Rule[] = [
  { label: 'x265', pattern: /\b(x[ -]?265|h[ -]?265|hevc)\b/i },
  { label: 'AV1', pattern: /\bav1\b/i },
  { label: 'x264', pattern: /\b(x[ -]?264|h[ -]?264|avc)\b/i },
  { label: 'XviD', pattern: /\b(xvid|divx)\b/i },
];

const AUDIO: Rule[] = [
  { label: 'Atmos', pattern: /\batmos\b/i },
  { label: 'TrueHD', pattern: /\btrue[ -]?hd\b/i },
  { label: 'DTS-HD', pattern: /\bdts[ -]?hd\b/i },
  { label: 'DTS', pattern: /\bdts\b/i },
  { label: 'DDP5.1', pattern: /\b(ddp[ -]?5[ -]?1|e[ -]?ac3|ddp)\b/i },
  { label: 'DD5.1', pattern: /\b(dd[ -]?5[ -]?1|ac3)\b/i },
  { label: 'FLAC', pattern: /\bflac\b/i },
  { label: 'AAC', pattern: /\baac\b/i },
  { label: 'MP3', pattern: /\bmp3\b/i },
];

const HDR: Rule[] = [
  { label: 'Dolby Vision', pattern: /\b(dolby vision|dovi|dv)\b/i },
  { label: 'HDR10+', pattern: /\bhdr10\+/i },
  { label: 'HDR10', pattern: /\bhdr10\b/i },
  { label: 'HDR', pattern: /\bhdr\b/i },
];

const LOW_QUALITY = new Set(['CAM', 'TS', 'SCR']);

/** `-GROUP` or `[GROUP]` at the end, which is where the releaser signs it. */
function releaseGroup(title: string): string | undefined {
  const bracketed = /[[(]([A-Za-z0-9._-]{2,20})[\])]\s*$/.exec(title.trim());
  if (bracketed) return bracketed[1];

  const trailing = /-\s*([A-Za-z0-9]{2,20})(?:\[[^\]]*\])?\s*$/.exec(
    title.trim().replace(/\.(mkv|mp4|avi)$/i, ''),
  );
  return trailing?.[1];
}

function seasonEpisode(haystack: string): {
  season?: number;
  episode?: number;
  completePack?: boolean;
} {
  const full = /\bs(\d{1,2}) ?e(\d{1,3})\b/i.exec(haystack);
  if (full) return { season: Number(full[1]), episode: Number(full[2]) };

  const cross = /\b(\d{1,2})x(\d{2,3})\b/.exec(haystack);
  if (cross) return { season: Number(cross[1]), episode: Number(cross[2]) };

  // A season range, e.g. S01-S05, is a pack rather than a single season.
  const range = /\bs(\d{1,2}) ?- ?s(\d{1,2})\b/i.exec(haystack);
  if (range) return { season: Number(range[1]), completePack: true };

  const seasonOnly = /\b(?:s(\d{1,2})|season (\d{1,2}))\b/i.exec(haystack);
  if (seasonOnly) {
    return {
      season: Number(seasonOnly[1] ?? seasonOnly[2]),
      completePack: /\bcomplete\b/i.test(haystack),
    };
  }

  if (/\bcomplete\b/i.test(haystack)) return { completePack: true };
  return {};
}

/**
 * A four-digit year, ignoring the ones that are really resolutions or episode
 * counts. Takes the last plausible match, since a title can itself contain a
 * year ("Blade Runner 2049 2017").
 */
function releaseYear(haystack: string): number | undefined {
  const matches = [...haystack.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1900 && year <= 2099);

  return matches.length > 0 ? matches[matches.length - 1] : undefined;
}

export function parseReleaseName(title: string): ParsedRelease {
  const haystack = normalise(title);
  const source = firstMatch(haystack, SOURCES);

  return {
    resolution: firstMatch(haystack, RESOLUTIONS),
    source,
    codec: firstMatch(haystack, CODECS),
    audio: firstMatch(haystack, AUDIO),
    hdr: firstMatch(haystack, HDR),
    ...seasonEpisode(haystack),
    year: releaseYear(haystack),
    group: releaseGroup(title),
    repack: /\b(repack|proper)\b/i.test(haystack),
    lowQuality: source !== undefined && LOW_QUALITY.has(source),
  };
}

/**
 * Tokens that mark the end of the title and the start of the release tags.
 * Everything before the first of these is what a human would call the film or
 * show; everything after describes the encode.
 */
const TITLE_STOP =
  /^(19\d{2}|20\d{2}|\d{3,4}[pi]|4k|uhd|s\d{1,2}(e\d{1,3})?|\d{1,2}x\d{2,3}|season|complete|bluray|blu-ray|bdrip|br-?rip|web|web-?dl|web-?rip|hdtv|dvdrip|hd-?rip|remux|hdcam|cam|hdts|ts|telesync|screener|scr|x26[45]|h\.?26[45]|hevc|av1|xvid|divx|repack|proper|multi|dual|extended|unrated|uncut|imax|remastered|hdr10?\+?|dv|dolby|atmos|truehd|dts(-?hd)?|ddp?5|aac|ac3|flac)$/i;

/**
 * The plain title and year, recovered from a release name.
 *
 * "The.Amateur.2025.1080p.WEB-DL.DDP5.1.x265-NeoNoir" is not something you can
 * look up anywhere — "The Amateur" (2025) is. This is what makes an external
 * metadata lookup possible.
 */
export function titleFromRelease(raw: string): { title: string; year?: number } {
  const cleaned = raw
    .replace(/[[\]{}()]/g, ' ')
    .replace(/_/g, ' ')
    .trim();

  const tokens = cleaned.split(/[.\s]+/).filter(Boolean);
  const kept: string[] = [];
  let year: number | undefined;

  for (const token of tokens) {
    if (TITLE_STOP.test(token)) {
      if (/^(19|20)\d{2}$/.test(token)) year = Number(token);
      break;
    }
    kept.push(token);
  }

  // A name that opens with a tag leaves nothing; the whole string beats empty.
  const title = (kept.length > 0 ? kept.join(' ') : cleaned)
    .replace(/[-:,\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, year: year ?? releaseYear(normalise(raw)) };
}

/** The one-line quality summary shown under a result, e.g. "1080p BluRay x265". */
export function qualityLabel(parsed: ParsedRelease): string {
  return [parsed.resolution, parsed.source, parsed.codec, parsed.hdr].filter(Boolean).join(' ');
}

/** `S01E05`, `S02`, or nothing when the release is not episodic. */
export function episodeLabel(parsed: ParsedRelease): string | undefined {
  if (parsed.season === undefined) return parsed.completePack ? 'Complete' : undefined;

  const season = `S${String(parsed.season).padStart(2, '0')}`;
  if (parsed.episode !== undefined) return `${season}E${String(parsed.episode).padStart(2, '0')}`;
  return parsed.completePack ? `${season} complete` : season;
}
