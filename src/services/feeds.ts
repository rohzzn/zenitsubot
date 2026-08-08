import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { UserError, UpstreamError, RateLimitError } from '../utils/errors.js';
import { logger } from './logger.js';

/**
 * Reading feeds.
 *
 * RSS 2.0, Atom and RDF all describe the same thing in incompatible tags, and
 * a subscription command has to accept whatever a site happens to publish. All
 * three are parsed into one shape here so nothing above this file has to know
 * which it got.
 *
 * cheerio in XML mode does the parsing rather than a dedicated feed library:
 * it is already a dependency, and the tag-name differences are the whole job.
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS_PER_POLL = 50;
/** Identifies the bot to hosts that rate-limit anonymous clients — Reddit does. */
const USER_AGENT = 'ZenitsuBot/1.0 (Discord feed reader; +https://github.com/rohzzn/zenitsubot)';

export interface FeedItemData {
  guid: string;
  title: string;
  link: string;
  author?: string;
  summary?: string;
  imageUrl?: string;
  publishedAt?: Date;
}

export interface ParsedFeed {
  title: string;
  siteUrl?: string;
  iconUrl?: string;
  items: FeedItemData[];
}

export interface FetchResult {
  /** Null when the server answered 304: nothing changed since last time. */
  feed: ParsedFeed | null;
  etag?: string;
  lastModified?: string;
}

function text($: cheerio.CheerioAPI, element: AnyNode, ...tags: string[]): string {
  for (const tag of tags) {
    // Namespaced tags such as dc:creator need escaping in a CSS selector.
    const found = $(element).children(tag.replace(':', '\\:')).first();
    if (found.length && found.text().trim()) return found.text().trim();
  }
  return '';
}

/** Strips markup and collapses whitespace, for a summary shown as plain text. */
function plain(html: string, max = 400): string {
  if (!html) return '';
  const stripped = cheerio.load(html).root().text();
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

/** Only http(s) links are ever surfaced; a feed is untrusted input. */
function safeLink(value: string | undefined, base?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The first image a feed offers, from any of the four places they put one. */
function findImage($: cheerio.CheerioAPI, element: AnyNode, base?: string): string | undefined {
  const enclosure = $(element).children('enclosure').filter('[type^="image"]').attr('url');
  if (enclosure) return safeLink(enclosure, base);

  const media =
    $(element).children('media\\:content').filter('[medium="image"]').attr('url') ??
    $(element).children('media\\:thumbnail').attr('url');
  if (media) return safeLink(media, base);

  // Last resort: the first <img> inside the item's HTML body.
  const body = text($, element, 'content:encoded', 'content', 'description');
  if (body.includes('<img')) {
    const src = cheerio.load(body)('img').first().attr('src');
    if (src) return safeLink(src, base);
  }

  return undefined;
}

export function parseFeed(xml: string, feedUrl: string): ParsedFeed {
  const $ = cheerio.load(xml, { xmlMode: true });

  const isAtom = $('feed').length > 0 && $('entry').length > 0;
  const channel = isAtom ? $('feed').first() : $('channel').first();

  if (!channel.length) throw new UserError('That URL does not look like an RSS or Atom feed.');

  const siteUrl = isAtom
    ? safeLink($('feed > link[rel="alternate"]').attr('href') ?? $('feed > link').attr('href'))
    : safeLink($('channel > link').first().text());

  const title =
    channel.children('title').first().text().trim() ||
    (siteUrl ? new URL(siteUrl).hostname : 'Untitled feed');

  const iconUrl =
    safeLink($('channel > image > url').first().text(), feedUrl) ??
    safeLink($('feed > icon').first().text(), feedUrl) ??
    safeLink($('feed > logo').first().text(), feedUrl);

  const nodes = isAtom ? $('entry').toArray() : $('item').toArray();
  const items: FeedItemData[] = [];

  for (const node of nodes.slice(0, MAX_ITEMS_PER_POLL)) {
    const link = isAtom
      ? safeLink($(node).children('link').attr('href'), feedUrl)
      : safeLink(text($, node, 'link'), feedUrl);

    const title = text($, node, 'title') || '(untitled)';

    // Identity, in descending order of trustworthiness. Falling back to the
    // title matters: a feed with neither guid nor link would otherwise treat
    // every poll as entirely new items.
    const guid = text($, node, 'guid', 'id') || link || title;
    if (!guid) continue;

    items.push({
      guid: guid.slice(0, 500),
      title: title.slice(0, 300),
      link: link ?? siteUrl ?? feedUrl,
      author:
        text($, node, 'dc:creator', 'author') ||
        $(node).children('author').children('name').first().text().trim() ||
        undefined,
      summary:
        plain(text($, node, 'description', 'summary', 'content:encoded', 'content')) || undefined,
      imageUrl: findImage($, node, feedUrl),
      publishedAt: parseDate(text($, node, 'pubDate', 'published', 'updated', 'dc:date')),
    });
  }

  return { title: title.slice(0, 200), siteUrl, iconUrl, items };
}

/**
 * Rejects anything that is not a public web address.
 *
 * A feed URL is user-supplied and fetched by a process sitting on the compose
 * network next to Lavalink, searxng and the database.
 */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UserError('That is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError('Only http and https feeds are supported.');
  }
  if (url.username || url.password) {
    throw new UserError('URLs with credentials in them are not accepted.');
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    /^\[/.test(host) ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) throw new UserError('That address is not publicly reachable.');
  return url;
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_FEED_BYTES) throw new UserError('That feed is too large to read.');

  const body = await response.text();
  if (body.length > MAX_FEED_BYTES) throw new UserError('That feed is too large to read.');
  return body;
}

/**
 * Fetches a feed, skipping the work when nothing has changed.
 *
 * ETag and Last-Modified turn an unchanged feed into a 304 with no body, which
 * is the difference between polling fifty feeds politely and being blocked.
 */
export async function fetchFeed(
  feedUrl: string,
  conditional: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = { Accept: 'application/rss+xml, application/xml, */*' };
  if (conditional.etag) headers['If-None-Match'] = conditional.etag;
  if (conditional.lastModified) headers['If-Modified-Since'] = conditional.lastModified;

  const response = await get(feedUrl, headers);

  if (response.status === 304) {
    return {
      feed: null,
      etag: conditional.etag ?? undefined,
      lastModified: conditional.lastModified ?? undefined,
    };
  }

  if (response.status === 404) throw new UserError('That feed no longer exists (404).');

  // Distinct from a failure: the feed is fine, we asked too often. The
  // scheduler waits longer rather than counting it against the feed's health.
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RateLimitError(
      new URL(feedUrl).hostname,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }
  if (!response.ok) {
    throw new UpstreamError(new URL(feedUrl).hostname, `The feed returned ${response.status}.`);
  }

  return {
    feed: parseFeed(await readBounded(response), feedUrl),
    etag: response.headers.get('etag') ?? undefined,
    lastModified: response.headers.get('last-modified') ?? undefined,
  };
}

export interface Candidate {
  url: string;
  title: string;
}

/**
 * Works out what someone meant.
 *
 * People paste a homepage far more often than a feed URL, and say "r/rust"
 * more often than they paste anything. Both have to work, or the first step of
 * subscribing is a research task.
 */
export async function discoverFeeds(input: string): Promise<Candidate[]> {
  const raw = input.trim();

  // r/name, /r/name, or a bare reddit.com link — all mean the same subreddit.
  const subreddit = raw.match(/^\/?r\/([A-Za-z0-9_]{2,30})\/?$/i)?.[1];
  if (subreddit) {
    return [
      { url: `https://www.reddit.com/r/${subreddit}/new/.rss`, title: `r/${subreddit} — new` },
      {
        url: `https://www.reddit.com/r/${subreddit}/top/.rss?t=day`,
        title: `r/${subreddit} — top today`,
      },
      { url: `https://www.reddit.com/r/${subreddit}/.rss`, title: `r/${subreddit} — hot` },
    ];
  }

  const url = assertPublicUrl(raw);

  // A reddit URL that is not already a feed becomes one by appending .rss.
  if (/(^|\.)reddit\.com$/i.test(url.hostname) && !url.pathname.endsWith('.rss')) {
    const path = url.pathname.replace(/\/$/, '');
    return [{ url: `https://www.reddit.com${path}/.rss`, title: `reddit${path}` }];
  }

  const response = await get(url.toString(), {
    Accept: 'application/rss+xml, application/xml, text/html;q=0.9',
  });

  if (!response.ok) {
    throw new UpstreamError(url.hostname, `That address returned ${response.status}.`);
  }

  const body = await readBounded(response);
  const contentType = response.headers.get('content-type') ?? '';

  // Already a feed: content type says so, or the body starts like one.
  if (/xml|rss|atom/i.test(contentType) || /^\s*<\?xml|<rss|<feed/i.test(body.slice(0, 200))) {
    const parsed = parseFeed(body, url.toString());
    return [{ url: url.toString(), title: parsed.title }];
  }

  // An HTML page: read its advertised feeds.
  const $ = cheerio.load(body);
  const found: Candidate[] = [];

  $('link[rel="alternate"]').each((_, element) => {
    const type = $(element).attr('type') ?? '';
    if (!/rss|atom|xml/i.test(type)) return;

    const href = safeLink($(element).attr('href'), url.toString());
    if (!href || found.some((c) => c.url === href)) return;

    found.push({ url: href, title: $(element).attr('title')?.trim() || href });
  });

  if (found.length === 0) {
    // The conventional paths, tried only after the page declared nothing.
    for (const guess of ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml']) {
      const candidate = new URL(guess, url.origin).toString();
      try {
        const probe = await get(candidate, { Accept: 'application/rss+xml, application/xml' });
        if (!probe.ok) continue;
        const parsed = parseFeed(await readBounded(probe), candidate);
        found.push({ url: candidate, title: parsed.title });
        break;
      } catch {
        // A guess that misses is not an error worth reporting.
      }
    }
  }

  if (found.length === 0) {
    throw new UserError(
      `No feed found at ${url.hostname}. Paste the feed URL directly if you know it.`,
    );
  }

  logger.debug({ host: url.hostname, count: found.length }, 'Discovered feeds');
  return found.slice(0, 5);
}

/** Whether an item passes a subscription's word filters. */
export function matchesFilters(
  item: { title: string; summary?: string | null },
  filters: { include?: string | null; exclude?: string | null },
): boolean {
  const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase();

  const words = (value?: string | null) =>
    (value ?? '')
      .split(',')
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);

  const exclude = words(filters.exclude);
  if (exclude.some((word) => haystack.includes(word))) return false;

  const include = words(filters.include);
  // An empty include list means everything, not nothing.
  return include.length === 0 || include.some((word) => haystack.includes(word));
}
