import { logger } from './logger.js';
import { torrent1337xDomains } from './config.js';
import {
  Torrent1337xError,
  bestSearchTerm,
  buildSearchPath,
  countMatchingTerms,
  distinctiveTerms,
  essentialTerms,
  is1337xChallengePage,
  matchesAllTerms,
  parse1337xDetails,
  parse1337xSearchResults,
  rankByRelevance,
  releaseKey,
  torrentIdFromUrl,
  torrentPath,
  type Leetx1337xOrder,
  type Leetx1337xSort,
  type Torrent1337xDetails,
  type Torrent1337xSearchResult,
} from './1337xParse.js';

/**
 * Search and torrent-page scraping for 1337x.
 *
 * The behaviour being reproduced comes from TUVIMEN/1337x-scraper by Dominik
 * Stanisław Suchora (GNU GPLv3): https://github.com/TUVIMEN/1337x-scraper
 *
 * What that scraper does and what this does are deliberately different in
 * scope. It walks every torrent id on the site; a Discord command must not.
 * Each invocation here fetches one search page, and one detail page only when
 * somebody asks for it. There is no crawler, no id enumeration and no attempt
 * to get past Cloudflare, a captcha or any other access control — when the
 * site refuses a scripted request, the command says so and stops.
 */

export {
  Torrent1337xError,
  LEETX_CATEGORIES,
  LEETX_ORDERS,
  LEETX_SORTS,
  normaliseCategory,
} from './1337xParse.js';
export type {
  Leetx1337xCategory,
  Leetx1337xOrder,
  Leetx1337xSort,
  Torrent1337xDetails,
  Torrent1337xFile,
  Torrent1337xSearchResult,
} from './1337xParse.js';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** One retry, for a connection that dropped rather than a site that said no. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;
const MAX_CONCURRENT_REQUESTS = 2;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 120;

const COOLDOWN_MS = 6_000;
const COOLDOWN_MAX_TRACKED = 500;

/**
 * Pages one search may look at. Bounded on purpose: enough to get past a page
 * of loose matches, nowhere near a crawl.
 */
const MAX_SEARCH_PAGES = 3;

/**
 * Hard ceiling on requests per mirror for one search, covering the differently
 * aimed probes as well as extra pages.
 */
const MAX_PROBES = 5;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 40;

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'ZenitsuBot/1.0 (+https://github.com/rohzzn/zenitsubot)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const UNAVAILABLE =
  '1337x is not answering right now. It rate-limits automated requests, so try again in a few minutes.';
const BLOCKED =
  '1337x is serving an anti-bot check to this request, so it cannot be read. Try again later.';

export interface Search1337xOptions {
  query: string;
  category?: string;
  sort?: Leetx1337xSort;
  order?: Leetx1337xOrder;
  page?: number;
  limit?: number;
}

/** Nothing in here is worth showing a user; it only decides mirror fallback. */
class MirrorFailure extends Error {
  constructor(
    readonly userMessage: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'MirrorFailure';
  }
}

// ------------------------------------------------------------- URL guarding

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * The single gate every outbound URL passes through, including each redirect
 * hop. Membership is decided on `origin`, so scheme, host and port all have to
 * match a configured mirror exactly — a look-alike host, an odd port or a
 * redirect off-site is rejected rather than followed.
 */
export function assert1337xUrl(input: string | URL, domains: string[]): URL {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(String(input).trim());
  } catch {
    throw new Torrent1337xError('That is not a valid URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Torrent1337xError('Only http and https links are supported.');
  }
  if (url.username || url.password) {
    throw new Torrent1337xError('URLs with credentials in them are not accepted.');
  }
  if (isIpLiteral(url.hostname)) {
    throw new Torrent1337xError('That host is an IP address, not a 1337x domain.');
  }
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Torrent1337xError('That host is a local or private address.');
  }
  if (!domains.includes(url.origin)) {
    throw new Torrent1337xError(
      `Only the configured 1337x domains are allowed: ${domains.join(', ')}.`,
    );
  }

  return url;
}

export interface Resolved1337xTorrent {
  id: number;
  /** Path on a mirror, kept separate from the origin so fallback still works. */
  path: string;
  /** Origin the user named, when they gave a full URL on a configured mirror. */
  preferredOrigin?: string;
}

/** Accepts either a numeric torrent id or a full detail URL on a known mirror. */
export function resolve1337xTorrent(
  torrent: string | number,
  domains: string[] = torrent1337xDomains(),
): Resolved1337xTorrent {
  const raw = String(torrent).trim();
  if (!raw) throw new Torrent1337xError('Give me a 1337x torrent URL or a numeric torrent id.');

  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Torrent1337xError('That is not a valid torrent id.');
    }
    return { id, path: torrentPath(id) };
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new Torrent1337xError(
      'Give me a numeric torrent id, or a full URL starting with https://.',
    );
  }

  const url = assert1337xUrl(raw, domains);
  const id = torrentIdFromUrl(url.pathname);
  if (!id) {
    throw new Torrent1337xError('That URL is not a 1337x torrent page (/torrent/<id>/...).');
  }

  // Query and fragment are dropped: nothing on a detail page needs them, and
  // they are the easiest place to hide something we would rather not send on.
  return { id, path: url.pathname, preferredOrigin: url.origin };
}

// ------------------------------------------------------------------- limits

let inFlight = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  while (inFlight >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight++;
  try {
    return await work();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

interface CacheEntry {
  expires: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown): void {
  // Insertion-ordered, so the first key is always the oldest write.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
}

/** Exposed for tests; also handy if a mirror starts serving stale pages. */
export function clear1337xCache(): void {
  cache.clear();
}

const lastUsed = new Map<string, number>();

/**
 * Per-user throttle. Returns the milliseconds left to wait, or 0 when the call
 * may proceed — and then counts it.
 *
 * Searching and opening a result are tracked separately, because they are one
 * continuous action from the user's point of view: making the first click
 * after a search wait would punish ordinary use while doing nothing extra to
 * bound the request rate.
 */
export function take1337xCooldown(userId: string, scope: 'search' | 'details' = 'search'): number {
  const key = `${scope}:${userId}`;
  const now = Date.now();
  const previous = lastUsed.get(key);

  if (previous !== undefined && now - previous < COOLDOWN_MS) {
    return COOLDOWN_MS - (now - previous);
  }

  if (lastUsed.size >= COOLDOWN_MAX_TRACKED) {
    for (const [tracked, when] of lastUsed) {
      if (now - when >= COOLDOWN_MS) lastUsed.delete(tracked);
    }
  }

  lastUsed.set(key, now);
  return 0;
}

// -------------------------------------------------------------------- fetch

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The connection is already gone; nothing to release.
  }
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await discard(response);
    throw new MirrorFailure(UNAVAILABLE, false);
  }

  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new MirrorFailure(UNAVAILABLE, false);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancel().
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

export interface Fetched1337xPage {
  html: string;
  /** URL the content actually came from, after any allowed redirects. */
  url: string;
}

async function attempt(start: URL, domains: string[]): Promise<Fetched1337xPage> {
  let url = assert1337xUrl(start, domains);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await withSlot(() =>
        fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: REQUEST_HEADERS,
        }),
      );
    } catch (err) {
      throw new MirrorFailure(UNAVAILABLE, true, err);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await discard(response);
      if (!location) throw new MirrorFailure(UNAVAILABLE, false);

      // Revalidated on every hop: an off-site redirect is a hard stop, not a
      // reason to widen the allowlist.
      url = assert1337xUrl(new URL(location, url), domains);
      continue;
    }

    if (response.status === 404) {
      await discard(response);
      throw new Torrent1337xError('That page does not exist on 1337x.');
    }

    if (response.status === 403 || response.status === 429 || response.status === 503) {
      await discard(response);
      throw new MirrorFailure(BLOCKED, false);
    }

    if (!response.ok) {
      await discard(response);
      throw new MirrorFailure(UNAVAILABLE, response.status >= 500);
    }

    const html = await readCapped(response);
    if (is1337xChallengePage(html)) throw new MirrorFailure(BLOCKED, false);

    return { html, url: url.toString() };
  }

  throw new MirrorFailure(UNAVAILABLE, false);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Requests one path, trying each configured mirror in turn and retrying once
 * per mirror when the failure looks transient. Bounded on every axis: no
 * crawling, no pagination, no recursion.
 */
export async function fetch1337xPage(
  path: string,
  domains: string[] = torrent1337xDomains(),
): Promise<Fetched1337xPage> {
  let lastMessage = UNAVAILABLE;

  for (const origin of domains) {
    for (let tries = 1; tries <= MAX_ATTEMPTS; tries++) {
      try {
        return await attempt(new URL(path, origin), domains);
      } catch (err) {
        if (err instanceof Torrent1337xError) throw err;
        if (!(err instanceof MirrorFailure)) throw err;

        lastMessage = err.userMessage;
        logger.warn(
          { err: err.cause ?? err, origin, path, attempt: tries },
          '1337x request failed',
        );

        if (!err.retryable || tries === MAX_ATTEMPTS) break;
        await sleep(RETRY_DELAY_MS * tries);
      }
    }
  }

  throw new Torrent1337xError(lastMessage);
}

/** One path from one named mirror, with the same retry rule and no fallback. */
async function fetchFromMirror(
  origin: string,
  path: string,
  domains: string[],
): Promise<Fetched1337xPage> {
  let failure: unknown;

  for (let tries = 1; tries <= MAX_ATTEMPTS; tries++) {
    try {
      return await attempt(new URL(path, origin), domains);
    } catch (err) {
      failure = err;
      if (err instanceof Torrent1337xError) throw err;
      if (!(err instanceof MirrorFailure) || !err.retryable || tries === MAX_ATTEMPTS) break;
      await sleep(RETRY_DELAY_MS * tries);
    }
  }

  throw failure;
}

// --------------------------------------------------------------- public API

function compare(a: number | undefined, b: number | undefined, order: Leetx1337xOrder): number {
  // Rows missing the sort key sink to the bottom either way.
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return order === 'asc' ? a - b : b - a;
}

function sortResults(
  results: Torrent1337xSearchResult[],
  sort: Leetx1337xSort,
  order: Leetx1337xOrder,
): Torrent1337xSearchResult[] {
  const keyed = results.map((result, index) => ({ result, index }));

  keyed.sort((a, b) => {
    let delta = 0;
    switch (sort) {
      case 'size':
        delta = compare(a.result.sizeBytes, b.result.sizeBytes, order);
        break;
      case 'leechers':
        delta = compare(a.result.leechers, b.result.leechers, order);
        break;
      case 'time': {
        const at = a.result.uploadedAt ? Date.parse(a.result.uploadedAt) : undefined;
        const bt = b.result.uploadedAt ? Date.parse(b.result.uploadedAt) : undefined;
        delta = compare(at, bt, order);
        break;
      }
      default:
        delta = compare(a.result.seeders, b.result.seeders, order);
    }
    // Ties keep the order the site returned them in.
    return delta !== 0 ? delta : a.index - b.index;
  });

  return keyed.map((entry) => entry.result);
}

/** One search page, from the cache when it is still warm. */
async function searchPage(origin: string, path: string, domains: string[]) {
  const cacheKey = `search:${origin}${path}`;
  const cached = cacheGet<Torrent1337xSearchResult[]>(cacheKey);
  if (cached) return cached;

  const page = await fetchFromMirror(origin, path, domains);
  const results = parse1337xSearchResults(page.html, page.url);

  cacheSet(cacheKey, results);
  return results;
}

/**
 * The same page from every configured mirror at once.
 *
 * Mirrors carry overlapping but different catalogues, so asking all of them
 * finds releases a single one has never indexed. One dead mirror no longer
 * costs anything either — its rejection resolves alongside the others rather
 * than delaying them. Failures are only fatal when every mirror failed.
 */
async function searchAllMirrors(
  path: string,
  domains: string[],
): Promise<{ results: Torrent1337xSearchResult[]; failure?: Torrent1337xError }> {
  const settled = await Promise.allSettled(
    domains.map((origin) => searchPage(origin, path, domains)),
  );

  const results: Torrent1337xSearchResult[] = [];
  let failure: Torrent1337xError | undefined;

  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
      continue;
    }

    const reason = outcome.reason;
    logger.warn({ err: reason, origin: domains[index], path }, '1337x mirror search failed');

    if (reason instanceof Torrent1337xError) failure = reason;
    else if (reason instanceof MirrorFailure) failure = new Torrent1337xError(reason.userMessage);
    else failure = new Torrent1337xError(UNAVAILABLE);
  }

  // Every mirror failed: the caller has nothing, so say why.
  return settled.every((outcome) => outcome.status === 'rejected')
    ? { results, failure }
    : { results };
}

export interface Search1337xOutcome {
  results: Torrent1337xSearchResult[];
  /**
   * Rows that matched some of the query but not all of it. Used to offer a
   * "did you mean" instead of a bare "nothing found".
   */
  nearMisses: Torrent1337xSearchResult[];
  /** What was actually sent to the indexer, after stopwords were dropped. */
  searchedFor: string;
  mirrors: number;
}

export async function search1337xDetailed(
  options: Search1337xOptions,
): Promise<Search1337xOutcome> {
  const sort: Leetx1337xSort = options.sort ?? 'seeders';
  const order: Leetx1337xOrder = options.order ?? 'desc';
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const firstPage = Math.max(1, Math.trunc(options.page ?? 1));
  const domains = torrent1337xDomains();

  // Two different reductions of the same query: the narrow one decides what to
  // ask the site for, the wider one decides which rows are worth showing.
  const terms = essentialTerms(options.query);
  const searchFor = distinctiveTerms(options.query).join(' ');
  const best = bestSearchTerm(options.query);

  /**
   * A handful of differently-aimed requests rather than pages of one.
   *
   * 1337x ORs the words together and ranks by the sort you asked for, so the
   * whole phrase sorted by seeders is the worst of both: unrelated popular
   * torrents crowd out the release you wanted. The narrow single-word probe
   * finds it, and the time-sorted probe catches releases too new to have
   * accumulated seeders — which is exactly what people search for.
   */
  const probes: Array<{ query: string; sort: Leetx1337xSort; page: number }> = [
    { query: searchFor, sort, page: firstPage },
  ];

  if (best && best !== searchFor) {
    probes.push({ query: best, sort, page: firstPage });
    probes.push({ query: best, sort: 'time', page: firstPage });
  }

  // Extra depth only on whichever probe is most targeted.
  const deepen = best && best !== searchFor ? best : searchFor;
  for (let page = firstPage + 1; page < firstPage + MAX_SEARCH_PAGES; page++) {
    probes.push({ query: deepen, sort, page });
  }

  const collected: Torrent1337xSearchResult[] = [];
  const seenIds = new Set<string>();
  const seenReleases = new Set<string>();
  let full: Torrent1337xSearchResult[] = [];
  let failure: Torrent1337xError | undefined;

  for (const probe of probes.slice(0, MAX_PROBES)) {
    const path = buildSearchPath({
      query: probe.query,
      category: options.category,
      sort: probe.sort,
      order,
      page: probe.page,
    });

    const outcome = await searchAllMirrors(path, domains);
    if (outcome.failure) {
      failure = outcome.failure;
      break;
    }

    for (const result of outcome.results) {
      // Ids collide across mirrors, so identity is the mirror plus the id;
      // the same release listed on two mirrors is then folded by its name.
      const idKey = `${new URL(result.pageUrl).origin}#${result.id}`;
      if (seenIds.has(idKey)) continue;
      seenIds.add(idKey);

      const release = releaseKey(result);
      if (seenReleases.has(release)) continue;
      seenReleases.add(release);

      collected.push(result);
    }

    full = collected.filter((result) => matchesAllTerms(result.title, terms));
    if (full.length >= limit) break;
  }

  if (failure && collected.length === 0) throw failure;

  // Rows carrying some of the query but not all of it.
  //
  // One essential word is enough to qualify, because a phrasing the site
  // cannot answer — "that new villeneuve dune movie" — should still surface
  // the Dune releases rather than nothing. Noise words were already dropped,
  // so this cannot drag in a title that merely shares "the".
  const nearMisses = rankByRelevance(
    collected.filter(
      (result) =>
        !matchesAllTerms(result.title, terms) && countMatchingTerms(result.title, terms) >= 1,
    ),
    terms,
  );

  // Exact matches first, then the best of the rest to fill the list out. A
  // page showing three results when twenty were fetched reads as broken, and
  // the near misses are often the same title spelled differently.
  const relevant = [...sortResults(full, sort, order), ...nearMisses].slice(0, limit);

  logger.debug(
    {
      query: options.query,
      searchedFor: searchFor,
      mirrors: domains.length,
      scanned: collected.length,
      matched: full.length,
    },
    '1337x search complete',
  );

  return {
    // Already ordered: exact matches sorted, then near misses by relevance.
    results: relevant,
    nearMisses: full.length > 0 ? sortResults(nearMisses, sort, order).slice(0, 5) : [],
    searchedFor: searchFor,
    mirrors: domains.length,
  };
}

export async function search1337x(
  options: Search1337xOptions,
): Promise<Torrent1337xSearchResult[]> {
  return (await search1337xDetailed(options)).results;
}

export async function scrape1337xTorrent(torrent: string | number): Promise<Torrent1337xDetails> {
  const domains = torrent1337xDomains();
  const resolved = resolve1337xTorrent(torrent, domains);

  const cacheKey = `torrent:${resolved.id}`;
  const cached = cacheGet<Torrent1337xDetails>(cacheKey);
  if (cached) return cached;

  // A mirror the user named is tried first, then the rest of the allowlist.
  const ordered = resolved.preferredOrigin
    ? [resolved.preferredOrigin, ...domains.filter((origin) => origin !== resolved.preferredOrigin)]
    : domains;

  const page = await fetch1337xPage(resolved.path, ordered);
  const details = parse1337xDetails(page.html, page.url, resolved.id);

  cacheSet(cacheKey, details);
  // Magnets are never logged in full: the infohash alone identifies the page.
  logger.debug(
    { id: details.id, infoHash: details.infoHash, files: details.files.length },
    '1337x torrent scraped',
  );

  return details;
}
