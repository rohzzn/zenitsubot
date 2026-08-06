import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from './logger.js';

const run = promisify(execFile);

const YTDLP = process.env.YTDLP_PATH ?? 'yt-dlp';
const METADATA_TIMEOUT_MS = 25_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_DURATION_SECONDS = 15 * 60;

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface MediaInfo {
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnail?: string;
  webpageUrl: string;
  extractor: string;
  isLive?: boolean;
  /** Bytes for the smallest muxed video, when the extractor reports a size. */
  smallestVideoBytes?: number;
}

export interface DownloadedMedia {
  buffer: Buffer;
  filename: string;
  info: MediaInfo;
}

/**
 * Only http(s) and no shell metacharacters. yt-dlp is invoked via execFile so
 * there is no shell to inject into, but a bad URL should fail early and clearly.
 */
export function normaliseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DownloadError('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DownloadError('Only http and https links are supported.');
  }
  return url;
}

function friendlyError(stderr: string): string {
  const text = stderr.toLowerCase();

  if (text.includes('private') || text.includes('login required') || text.includes('sign in'))
    return 'That post is private or needs a login.';
  if (text.includes('unsupported url')) return 'That site is not supported.';
  if (text.includes('video unavailable') || text.includes('not available'))
    return 'That video is unavailable.';
  if (text.includes('age')) return 'That video is age restricted.';
  if (text.includes('geo') || text.includes('country')) return 'That video is region locked.';
  if (text.includes('rate') || text.includes('429')) return 'Rate limited by the site. Try later.';
  return 'Could not fetch that link.';
}

export async function fetchInfo(url: URL): Promise<MediaInfo> {
  try {
    const { stdout } = await run(
      YTDLP,
      [
        '--dump-single-json',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout',
        '15',
        url.toString(),
      ],
      { timeout: METADATA_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    );

    const data = JSON.parse(stdout) as Record<string, any>;

    const muxedSizes: number[] = (data.formats ?? [])
      .filter((f: any) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
      .map((f: any) => f.filesize ?? f.filesize_approx)
      .filter((n: unknown): n is number => typeof n === 'number' && n > 0);

    return {
      title: data.title ?? 'Untitled',
      uploader: data.uploader ?? data.channel ?? undefined,
      durationSeconds: typeof data.duration === 'number' ? data.duration : undefined,
      thumbnail: data.thumbnail ?? undefined,
      webpageUrl: data.webpage_url ?? url.toString(),
      extractor: data.extractor_key ?? data.extractor ?? 'unknown',
      isLive: Boolean(data.is_live),
      smallestVideoBytes: muxedSizes.length ? Math.min(...muxedSizes) : undefined,
    };
  } catch (err: any) {
    logger.warn({ err: err?.message, url: url.toString() }, 'yt-dlp metadata failed');
    throw new DownloadError(friendlyError(String(err?.stderr ?? err?.message ?? '')));
  }
}

/** Explains the size ceiling with real numbers, and points at audio-only. */
function tooLargeError(info: MediaInfo, maxBytes: number, audioOnly: boolean): DownloadError {
  const limitMb = (maxBytes / 1048576).toFixed(0);

  if (info.smallestVideoBytes) {
    const actualMb = (info.smallestVideoBytes / 1048576).toFixed(1);
    return new DownloadError(
      `Smallest version is ${actualMb} MB, over this server's ${limitMb} MB upload limit.` +
        (audioOnly ? '' : ' Try `audio_only: True`, or boost the server to raise the limit.'),
    );
  }

  return new DownloadError(
    `Nothing available fits under ${limitMb} MB.` + (audioOnly ? '' : ' Try `audio_only: True`.'),
  );
}

/**
 * Downloads the largest already-muxed format that fits the byte budget.
 *
 * ffmpeg is not installed, so separate video and audio streams cannot be
 * merged. That is fine here: Discord's limit is small enough that the
 * progressive formats are the only realistic candidates anyway.
 */
export async function downloadWithinBudget(
  url: URL,
  maxBytes: number,
  audioOnly = false,
): Promise<DownloadedMedia> {
  const info = await fetchInfo(url);

  if (info.isLive) throw new DownloadError('That is a live stream.');
  if (info.durationSeconds && info.durationSeconds > MAX_DURATION_SECONDS) {
    const minutes = Math.round(info.durationSeconds / 60);
    throw new DownloadError(`That is ${minutes} minutes long. The limit is 15.`);
  }

  const budget = Math.floor(maxBytes * 0.95);

  // Many extractors leave `filesize` null and only populate `filesize_approx`,
  // so a selector testing filesize alone matches nothing. Each preference is
  // tried in turn, ending with the smallest available so --max-filesize is what
  // ultimately enforces the ceiling.
  const format = audioOnly
    ? [`ba[filesize<${budget}]`, `ba[filesize_approx<${budget}]`, 'ba', `wa`].join('/')
    : [
        `b[filesize<${budget}][vcodec!=none][acodec!=none]`,
        `b[filesize_approx<${budget}][vcodec!=none][acodec!=none]`,
        `b*[filesize<${budget}][vcodec!=none][acodec!=none]`,
        `b*[filesize_approx<${budget}][vcodec!=none][acodec!=none]`,
        'w[vcodec!=none][acodec!=none]',
      ].join('/');

  const dir = await mkdtemp(path.join(tmpdir(), 'zenitsu-dl-'));

  try {
    await run(
      YTDLP,
      [
        '--no-playlist',
        '--no-warnings',
        '--no-part',
        '--socket-timeout',
        '20',
        '--max-filesize',
        `${budget}`,
        '-f',
        format,
        '-o',
        path.join(dir, '%(title).80s.%(ext)s'),
        url.toString(),
      ],
      { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );

    const files = await readdir(dir);
    if (files.length === 0) throw tooLargeError(info, maxBytes, audioOnly);

    // Largest file that still fits, so quality is the best available.
    let best: { name: string; size: number } | null = null;
    for (const name of files) {
      const { size } = await stat(path.join(dir, name));
      if (size <= maxBytes && (!best || size > best.size)) best = { name, size };
    }

    if (!best) throw tooLargeError(info, maxBytes, audioOnly);

    return {
      buffer: await readFile(path.join(dir, best.name)),
      filename: best.name,
      info,
    };
  } catch (err: any) {
    if (err instanceof DownloadError) throw err;
    logger.warn({ err: err?.message, url: url.toString() }, 'yt-dlp download failed');
    throw new DownloadError(friendlyError(String(err?.stderr ?? err?.message ?? '')));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function formatDuration(seconds?: number): string {
  if (!seconds) return 'unknown';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
