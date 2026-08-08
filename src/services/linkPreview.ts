import * as cheerio from 'cheerio';
import { logger } from './logger.js';
import { UserError } from '../utils/errors.js';

/**
 * What a link is, for an announcement.
 *
 * Deliberately not the browserless path that /inspect uses. Rendering a page
 * in a headless browser takes seconds and is overkill here: the sites people
 * announce serve their OpenGraph tags in the initial HTML, because that is
 * what every other unfurler reads. A plain fetch is an order of magnitude
 * faster and fails the same way.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Presenting as a browser.
 *
 * Not evasion — these sites serve OpenGraph tags precisely so that unfurlers
 * can read them, and several return an empty shell to a client that sends no
 * recognisable user agent at all.
 */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export type LinkKind =
  | 'youtube-video'
  | 'youtube-live'
  | 'twitch-stream'
  | 'twitch-clip'
  | 'x-post'
  | 'instagram'
  | 'tiktok'
  | 'generic';

export interface LinkPreview {
  kind: LinkKind;
  url: string;
  title?: string;
  description?: string;
  image?: string;
  /** Channel, streamer, or account name. */
  author?: string;
  authorUrl?: string;
  siteName?: string;
  /** Brand colour for the card's accent. */
  accent: number;
  /** What the announcement should call this, e.g. "New video" or "Live now". */
  headline: string;
  /** True when the metadata came back thin and the card will be plain. */
  sparse: boolean;
}

/** Brand colours, so a YouTube post looks like a YouTube post. */
const ACCENTS: Record<string, number> = {
  'youtube-video': 0xff0000,
  'youtube-live': 0xff0000,
  'twitch-stream': 0x9146ff,
  'twitch-clip': 0x9146ff,
  'x-post': 0x000000,
  instagram: 0xe1306c,
  tiktok: 0x00f2ea,
  generic: 0x5865f2,
};

const HEADLINES: Record<LinkKind, string> = {
  'youtube-video': 'New video',
  'youtube-live': 'Live now',
  'twitch-stream': 'Live on Twitch',
  'twitch-clip': 'New clip',
  'x-post': 'New post',
  instagram: 'New post',
  tiktok: 'New video',
  generic: 'New link',
};

function classify(url: URL): LinkKind {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) {
    // A "live" URL, or a watch page the metadata later confirms is a stream.
    return url.pathname.startsWith('/live') || url.searchParams.has('live')
      ? 'youtube-live'
      : 'youtube-video';
  }
  if (/(^|\.)twitch\.tv$/.test(host)) {
    return url.pathname.includes('/clip/') ? 'twitch-clip' : 'twitch-stream';
  }
  if (/(^|\.)(twitter|x)\.com$/.test(host)) return 'x-post';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';

  return 'generic';
}

/** Rejects anything that is not a public web address. */
function assertPublic(raw: string): URL {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UserError('That is not a valid link.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError('Only http and https links work.');
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) throw new UserError('That address is not publicly reachable.');
  return url;
}

async function get(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!response.ok) return null;

    const body = await response.text();
    return body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * YouTube's oEmbed endpoint.
 *
 * Preferred over scraping because it is a supported API, needs no key, and
 * returns the channel name — which the OpenGraph tags do not.
 */
async function youtubeOembed(url: string): Promise<Partial<LinkPreview> | null> {
  const body = await get(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  );
  if (!body) return null;

  try {
    const data = JSON.parse(body) as {
      title?: string;
      author_name?: string;
      author_url?: string;
      thumbnail_url?: string;
    };

    return {
      title: data.title,
      author: data.author_name,
      authorUrl: data.author_url,
      image: data.thumbnail_url?.replace('hqdefault', 'maxresdefault'),
    };
  } catch {
    return null;
  }
}

function readOpenGraph(html: string, base: string) {
  const $ = cheerio.load(html);

  const meta = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value =
        $(`meta[property="${name}"]`).attr('content') ?? $(`meta[name="${name}"]`).attr('content');
      if (value?.trim()) return value.trim();
    }
    return undefined;
  };

  const absolute = (value?: string) => {
    if (!value) return undefined;
    try {
      return new URL(value, base).toString();
    } catch {
      return undefined;
    }
  };

  return {
    title: meta('og:title', 'twitter:title') ?? ($('title').first().text().trim() || undefined),
    description: meta('og:description', 'twitter:description', 'description'),
    image: absolute(meta('og:image:secure_url', 'og:image', 'twitter:image')),
    siteName: meta('og:site_name'),
    author: meta('author', 'article:author', 'twitter:creator'),
    // YouTube marks a live broadcast in its own namespace.
    live: meta('og:video:tag') === 'live' || /isLiveBroadcast|"isLive":true/.test(html),
  };
}

export async function previewLink(raw: string): Promise<LinkPreview> {
  const url = assertPublic(raw);
  let kind = classify(url);

  const preview: LinkPreview = {
    kind,
    url: url.toString(),
    accent: ACCENTS[kind] ?? ACCENTS.generic!,
    headline: HEADLINES[kind],
    sparse: true,
  };

  // YouTube first, because oEmbed is better than anything scraped.
  if (kind === 'youtube-video' || kind === 'youtube-live') {
    const oembed = await youtubeOembed(url.toString());
    if (oembed) {
      Object.assign(preview, oembed);
      preview.sparse = false;
    }
  }

  const html = await get(url.toString());

  if (html) {
    const tags = readOpenGraph(html, url.toString());

    // oEmbed values win where both exist: they are structured rather than
    // whatever the page chose to put in a share card.
    preview.title ??= tags.title;
    preview.description ??= tags.description;
    preview.image ??= tags.image;
    preview.author ??= tags.author;
    preview.siteName ??= tags.siteName;

    // A title that is just the site's own name is not metadata about the post.
    // Instagram answers an unauthenticated request with title "Instagram" and
    // nothing else, which would otherwise pass for a real preview and produce
    // a card headed "Instagram".
    const meaningful =
      tags.title &&
      tags.title.trim().toLowerCase() !== url.hostname.replace(/^www\./, '').split('.')[0];

    if (meaningful || tags.image) preview.sparse = false;
    if (!meaningful) preview.title = preview.title === tags.title ? undefined : preview.title;

    // A watch page that turns out to be a stream.
    if (kind === 'youtube-video' && tags.live) {
      kind = 'youtube-live';
      preview.kind = kind;
      preview.headline = HEADLINES[kind];
    }
  }

  preview.accent = ACCENTS[preview.kind] ?? ACCENTS.generic!;

  if (preview.sparse) {
    // Logged rather than thrown: X and Instagram routinely refuse, and a card
    // with the message and a link is still a perfectly good announcement.
    logger.debug({ host: url.hostname }, 'Link preview came back sparse');
  }

  return preview;
}
