import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Text } from 'domhandler';

/**
 * Parsing for 1337x search-result and torrent pages.
 *
 * Which fields exist, where they sit on the page, how sizes and dates are
 * converted and how a torrent id is read out of a URL are all adapted from
 * TUVIMEN/1337x-scraper (`torrents.py`, `links.py`) by Dominik Stanisław
 * Suchora, which is licensed GNU GPLv3:
 *
 *   https://github.com/TUVIMEN/1337x-scraper
 *
 * The Reliq expressions there were not translated literally — the same fields
 * are located with cheerio, and every lookup is optional so one missing value
 * never discards an otherwise usable result.
 *
 * Deliberately free of network code: everything here runs against a string of
 * HTML, which is what makes the fixtures in `tests/` possible.
 */

export class Torrent1337xError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Torrent1337xError';
  }
}

export interface Torrent1337xSearchResult {
  id: number;
  title: string;
  pageUrl: string;
  category?: string;
  /** Release type, e.g. "Linux", "HD", "E-Books". Separate from the category. */
  type?: string;
  /** Uploader carries a verified/VIP badge. Not every mirror renders these. */
  trusted?: boolean;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  uploadedAt?: string;
  uploader?: string;
  uploaderUrl?: string;
}

export interface Torrent1337xFile {
  type?: string;
  name: string;
  sizeBytes?: number;
}

export interface Torrent1337xDetails {
  id: number;
  title: string;
  pageUrl: string;
  magnet?: string;
  infoHash?: string;
  category?: string;
  type?: string;
  language?: string;
  sizeBytes?: number;
  uploader?: string;
  uploaderUrl?: string;
  downloads?: number;
  uploadedAt?: string;
  checkedAt?: string;
  seeders?: number;
  leechers?: number;
  description?: string;
  trackers: string[];
  files: Torrent1337xFile[];
  coverUrl?: string;
  rating?: number;
  metadataTitle?: string;
  metadataCategories: string[];
  metadataDescription?: string;
}

/** Categories 1337x accepts in a `/sort-category-search/` path. */
export const LEETX_CATEGORIES = [
  'Movies',
  'TV',
  'Games',
  'Music',
  'Apps',
  'Anime',
  'Documentaries',
  'XXX',
  'Other',
] as const;

export type Leetx1337xCategory = (typeof LEETX_CATEGORIES)[number];

export const LEETX_SORTS = ['seeders', 'leechers', 'time', 'size'] as const;
export type Leetx1337xSort = (typeof LEETX_SORTS)[number];

export const LEETX_ORDERS = ['desc', 'asc'] as const;
export type Leetx1337xOrder = (typeof LEETX_ORDERS)[number];

/**
 * A torrent with several thousand files would otherwise be held in memory in
 * full to show a preview of the first handful.
 */
const MAX_FILES = 500;

// ------------------------------------------------------------------ helpers

/** Collapses runs of whitespace, including the non-breaking spaces 1337x uses. */
export function collapse(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A non-negative integer, ignoring thousands separators and stray markup. */
export function parseCount(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[,\s\u00a0]/g, '');
  const match = /^-?\d+/.exec(digits);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

const SIZE_MULTIPLIERS: Record<string, number> = {
  b: 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
  t: 1024 ** 4,
  p: 1024 ** 5,
};

/**
 * "1.4 MB" -> 1468006.
 *
 * Binary units throughout, matching the reference scraper: 1 KB is 1024 bytes.
 * Anything that does not parse cleanly end to end returns undefined rather
 * than a misleading zero.
 */
export function parseSizeToBytes(raw?: string | null): number | undefined {
  if (!raw) return undefined;

  const text = collapse(raw).replace(/,/g, '');
  const match = /^(\d+(?:\.\d+)?)\s*([kmgtp])?(i)?(b(?:ytes?)?)?$/i.exec(text);
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;

  const unit = (match[2] ?? 'b').toLowerCase();
  // A bare number with no unit at all is not a size we can trust.
  if (!match[2] && !match[4]) return undefined;

  const multiplier = SIZE_MULTIPLIERS[unit];
  if (multiplier === undefined) return undefined;

  return Math.trunc(amount * multiplier);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const RELATIVE_UNITS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86_400,
  week: 604_800,
  // The reference approximates the same way; 1337x only ever renders whole units.
  month: 86_400 * 30.5,
  year: 86_400 * 365.25,
};

/** `%y`-style two-digit years: 00-68 are 2000s, 69-99 are 1900s. */
function expandYear(short: number): number {
  return short <= 68 ? 2000 + short : 1900 + short;
}

/**
 * 1337x renders dates three different ways depending on how old a torrent is.
 * All three collapse to an ISO-8601 UTC string here.
 *
 *   "Jun. 10th '25"  absolute
 *   "3:32pm"         earlier today
 *   "2 days ago"     relative
 */
export function parseTorrentDate(raw?: string | null, now: Date = new Date()): string | undefined {
  if (!raw) return undefined;
  const text = collapse(raw);
  if (!text) return undefined;

  const absolute = /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s+'?(\d{2,4})$/.exec(text);
  if (absolute) {
    const month = MONTHS.indexOf(absolute[1]!.slice(0, 3).toLowerCase());
    const day = Number(absolute[2]);
    const rawYear = Number(absolute[3]);
    const year = absolute[3]!.length <= 2 ? expandYear(rawYear) : rawYear;

    if (month >= 0 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
    return undefined;
  }

  const clock = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(text);
  if (clock) {
    let hour = Number(clock[1]) % 12;
    if (clock[3]!.toLowerCase() === 'pm') hour += 12;

    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, Number(clock[2])),
    ).toISOString();
  }

  const relative = /^(\d+)\s+([a-z]+?)s?\s+ago$/i.exec(text);
  if (relative) {
    const seconds = RELATIVE_UNITS[relative[2]!.toLowerCase()];
    if (seconds === undefined) return undefined;
    return new Date(now.getTime() - Number(relative[1]) * seconds * 1000).toISOString();
  }

  // Anything else the site starts emitting: take it if Date can read it.
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/** Reads the numeric id out of a `/torrent/{id}/{slug}/` path or full URL. */
export function torrentIdFromUrl(value: string): number | undefined {
  const match = /\/torrent\/(\d+)(?:[/?#]|$)/.exec(value);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Resolves a possibly relative or protocol-relative href against a base. */
export function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * HTML to something safe to put in an embed: tags gone, entities decoded,
 * `<br>` and block ends turned into real newlines.
 */
export function plainText(html?: string | null): string {
  if (!html) return '';

  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n');

  // Loaded as a fragment, so no implicit <html>/<body> wrapper can duplicate text.
  const text = cheerio.load(withBreaks, null, false).root().text();

  return text
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The 40-hex infohash carried by a magnet URI, uppercased as 1337x shows it. */
export function infoHashFromMagnet(magnet?: string | null): string | undefined {
  if (!magnet) return undefined;
  const match = /xt=urn:btih:([a-z0-9]{40}|[a-z2-7]{32})/i.exec(magnet);
  if (!match) return undefined;

  const value = match[1]!;
  if (/^[a-f0-9]{40}$/i.test(value)) return value.toUpperCase();

  // Base32 form: 32 characters of 5 bits each make the same 20 bytes.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) return undefined;
    bits += index.toString(2).padStart(5, '0');
  }

  return (bits.slice(0, 160).match(/.{8}/g) ?? [])
    .map((byte) => parseInt(byte, 2).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Announce URLs, deduplicated case-insensitively but kept in page order. */
export function dedupeTrackers(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const tracker = collapse(value);
    if (!tracker || !tracker.includes('://')) continue;
    const key = tracker.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tracker);
  }

  return out;
}

// ------------------------------------------------------------ URL building

/**
 * The reference scraper flattens a query to a hyphenated slug before putting
 * it in the path, and 1337x expects exactly that shape.
 */
export function slugifyQuery(query: string): string {
  const cleaned = query
    // Every character the reference maps to a space, plus any whitespace.
    .replace(/[!@#$%^&*()[\]{};:'"/?.>,<=+\-\\|~`\s\u00a0]/g, ' ')
    .toLowerCase();

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('-');
}

/** Case-insensitively resolves a user-supplied category to a supported one. */
export function normaliseCategory(value?: string | null): Leetx1337xCategory | undefined {
  if (!value) return undefined;
  const needle = collapse(value).toLowerCase();
  return LEETX_CATEGORIES.find((category) => category.toLowerCase() === needle);
}

export interface SearchPathOptions {
  query: string;
  category?: string;
  sort?: Leetx1337xSort;
  order?: Leetx1337xOrder;
  page?: number;
}

/**
 * `/sort-search/` and `/sort-category-search/` rather than `/search/`: the
 * reference notes the plain search endpoint is the one behind a challenge.
 */
export function buildSearchPath(options: SearchPathOptions): string {
  const slug = slugifyQuery(options.query);
  if (!slug) {
    throw new Torrent1337xError('That search has nothing to look for. Try different words.');
  }

  const sort: Leetx1337xSort = options.sort ?? 'seeders';
  const order: Leetx1337xOrder = options.order ?? 'desc';
  const page = Math.max(1, Math.trunc(options.page ?? 1));

  if (!LEETX_SORTS.includes(sort)) throw new Torrent1337xError(`Unsupported sort "${sort}".`);
  if (!LEETX_ORDERS.includes(order)) throw new Torrent1337xError(`Unsupported order "${order}".`);

  if (options.category) {
    const category = normaliseCategory(options.category);
    if (!category) {
      throw new Torrent1337xError(`Unknown category. Pick one of: ${LEETX_CATEGORIES.join(', ')}.`);
    }
    return `/sort-category-search/${slug}/${category}/${sort}/${order}/${page}/`;
  }

  return `/sort-search/${slug}/${sort}/${order}/${page}/`;
}

/** Canonical detail path for an id; 1337x ignores the slug segment. */
export function torrentPath(id: number): string {
  return `/torrent/${id}/-/`;
}

// --------------------------------------------------------------- relevance

/** Lowercased, punctuation flattened, so "S01.E02" and "s01 e02" compare equal. */
function normaliseForMatching(value: string): string {
  return collapse(value.replace(/[^\p{L}\p{N}]+/gu, ' ')).toLowerCase();
}

/**
 * Words too common to tell one release from another. Dropping them from the
 * *search* term is what makes "the office" reach office releases instead of
 * every title on the site that happens to contain "the"; they are still
 * required when matching, so the phrase is not lost.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'de',
  'for',
  'in',
  'la',
  'le',
  'of',
  'on',
  'or',
  'the',
  'to',
  'vs',
  'with',
  // Words common enough in release names to be useless as a search term.
  // "brand new day" searched whole drowns in everything containing "day";
  // searched as "brand" it lands on the right release immediately.
  'complete',
  'day',
  'episode',
  'film',
  'full',
  'movie',
  'new',
  'part',
  'season',
  'series',
  'show',
]);

/**
 * Words that will never appear in a release title, so requiring them would
 * throw away the right answer. Grammatical filler plus the quality vocabulary,
 * which belongs in a filter rather than in the title match: nobody names a
 * file "in 4k", they name it "2160p".
 */
const MATCH_NOISE = new Set([
  'a',
  'an',
  'and',
  'any',
  'at',
  'best',
  'bluray',
  'download',
  'film',
  'for',
  'free',
  'hd',
  'hevc',
  'in',
  'is',
  'it',
  'latest',
  'me',
  'movie',
  'my',
  'of',
  'on',
  'or',
  'please',
  'quality',
  'that',
  'the',
  'this',
  'to',
  'torrent',
  'uhd',
  'want',
  'watch',
  'webrip',
  'x264',
  'x265',
  '4k',
  '480p',
  '720p',
  '1080p',
  '2160p',
]);

/** The words a title has to contain for a result to be worth showing. */
export function queryTerms(query: string): string[] {
  return normaliseForMatching(query).split(' ').filter(Boolean);
}

/**
 * The words worth holding a title to.
 *
 * "that new villeneuve dune movie in 4k" only really asks for three things;
 * demanding the other four is why a plain-English search used to come back
 * empty whenever the model was unavailable to rewrite it.
 */
export function essentialTerms(query: string): string[] {
  const terms = queryTerms(query);
  const essential = terms.filter((term) => !MATCH_NOISE.has(term));
  return essential.length > 0 ? essential : terms;
}

/**
 * The words worth sending to 1337x. Falls back to every term when the query is
 * nothing but stopwords or numbers.
 */
export function distinctiveTerms(query: string): string[] {
  const terms = queryTerms(query);
  const distinctive = terms.filter((term) => !STOPWORDS.has(term) && !/^\d{1,2}$/.test(term));
  return distinctive.length > 0 ? distinctive : terms;
}

/**
 * The single word most likely to pin down the release.
 *
 * 1337x ORs every word together, so the more words are sent the more unrelated
 * rows come back — and the wanted one gets pushed off page one by whatever
 * popular torrent happens to share a common word. Asking for one rare word and
 * filtering locally is far more precise: "brand new day" sorted by seeders does
 * not surface Spider-Man at all, while "brand" puts it first.
 *
 * Length stands in for rarity, which is crude but needs no corpus.
 */
export function bestSearchTerm(query: string): string | undefined {
  const terms = distinctiveTerms(query);
  if (terms.length === 0) return undefined;

  return terms.reduce((best, term) => (term.length > best.length ? term : best));
}

/**
 * Whether a term appears in a title as a word, or as the start of one.
 *
 * Prefix rather than plain substring: "the" must not match "Panther", but
 * "s01" does have to match the single token "s01e04".
 */
function titleHasTerm(titleTokens: string[], term: string): boolean {
  return titleTokens.some((token) => token.startsWith(term));
}

export function countMatchingTerms(title: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const tokens = normaliseForMatching(title).split(' ');
  return terms.filter((term) => titleHasTerm(tokens, term)).length;
}

export function matchesAllTerms(title: string, terms: string[]): boolean {
  return terms.length > 0 && countMatchingTerms(title, terms) === terms.length;
}

/**
 * Orders results by how much of the query their title actually contains.
 *
 * 1337x matches search words with OR, so "breaking bad" comes back led by
 * "Bad Boys for Life" — the site has no phrase search on any endpoint. Sorting
 * by term coverage first is what makes a multi-word search usable; ties keep
 * the order the site returned.
 */
/**
 * Identity for the same release seen twice.
 *
 * Mirrors carry overlapping catalogues under different ids, so the id alone
 * will not collapse them. Title plus size is not infallible — two encodes can
 * land on the same byte count — but it is the only key available without
 * fetching every detail page for its infohash.
 */
export function releaseKey(result: { title: string; sizeBytes?: number }): string {
  const title = normaliseForMatching(result.title).replace(/ /g, '');
  return `${title}|${result.sizeBytes ?? 0}`;
}

export function rankByRelevance<T extends { title: string }>(results: T[], terms: string[]): T[] {
  if (terms.length === 0) return results;

  return results
    .map((result, index) => ({ result, index, score: countMatchingTerms(result.title, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.result);
}

// -------------------------------------------------------------- page checks

/** 1337x answers a missing torrent with a 200 and an "Error 404" heading. */
export function is1337xNotFoundPage(html: string): boolean {
  if (!html) return false;
  const $ = cheerio.load(html);
  const headings = $('h1, h2, title')
    .map((_, el) => collapse($(el).text()).toLowerCase())
    .get();

  return headings.some((heading) => heading.includes('error 404') || heading === '404');
}

const CHALLENGE_MARKERS = [
  'just a moment',
  'cf-browser-verification',
  'cf_chl_opt',
  'checking your browser',
  'attention required! | cloudflare',
  'enable javascript and cookies to continue',
  'ddos-guard',
];

/**
 * Recognises an anti-bot interstitial so the caller can back off and say so.
 * Nothing here tries to solve or bypass one.
 */
export function is1337xChallengePage(html: string): boolean {
  if (!html) return false;
  const sample = html.slice(0, 8000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => sample.includes(marker));
}

// ----------------------------------------------------------- search results

function titleCase(value: string): string {
  const text = collapse(value.replace(/-/g, ' '));
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** `flaticon-linux` names the release type, not the top-level category. */
function typeFromIcon(classes?: string): string | undefined {
  if (!classes) return undefined;

  for (const token of classes.split(/\s+/)) {
    if (!token.startsWith('flaticon-')) continue;
    return titleCase(token.slice('flaticon-'.length)) || undefined;
  }

  return undefined;
}

/**
 * Category and type for a result row.
 *
 * The row's icon links to `/sub/{category}/{type}/1/`, which is the only place
 * either label appears in full — and it agrees with the detail page (`apps` /
 * `Linux` there reads Category "Apps", Type "Linux"). The icon's `flaticon-`
 * class looks like a category but is really the type, so it is used only as a
 * fallback for older layouts whose href is the numeric `/sub/54/0/` form.
 */
function rowLabels(iconLink: Cheerio<AnyNode>): { category?: string; type?: string } {
  const segments = /\/sub\/([^/]+)\/([^/]+)\//.exec(iconLink.attr('href') ?? '');

  if (segments && !/^\d+$/.test(segments[1]!)) {
    const rawCategory = decodeURIComponent(segments[1]!);
    const rawType = collapse(decodeURIComponent(segments[2]!));

    return {
      category: normaliseCategory(rawCategory.replace(/-/g, ' ')) ?? titleCase(rawCategory),
      type: rawType && rawType !== '0' ? rawType : undefined,
    };
  }

  return { type: typeFromIcon(iconLink.find('i, span').first().attr('class')) };
}

/**
 * The value out of a result-row cell.
 *
 * Direct text nodes come first: 1337x puts the real value there and hides a
 * duplicate seeder/leecher count in a nested `<span>` for the mobile layout,
 * so taking the whole cell's text would append a stray number to the size.
 * A cell that has no loose text at all falls back to its full text with the
 * icons and those known duplicates stripped, which keeps working if the site
 * ever wraps the value in an element of its own.
 */
function cellText(cell: Cheerio<AnyNode>): string {
  if (cell.length === 0) return '';

  const direct = collapse(
    cell
      .contents()
      .toArray()
      .filter((node): node is Text => node.type === 'text')
      .map((node) => node.data)
      .join(' '),
  );
  if (direct) return direct;

  const clone = cell.clone();
  clone.find('i, span.seeds, span.leeches, span[class*="mob-"]').remove();
  return collapse(clone.text());
}

export function parse1337xSearchResults(
  html: string,
  baseUrl: string,
  now: Date = new Date(),
): Torrent1337xSearchResult[] {
  const $ = cheerio.load(html);
  const results: Torrent1337xSearchResult[] = [];
  const seen = new Set<number>();

  const rows = $('table.table-list tbody tr').length
    ? $('table.table-list tbody tr')
    : $('table.table-list tr');

  rows.each((_, element) => {
    const row = $(element);
    // The header row on tables that ship without a <thead>.
    if (row.find('th').length > 0) return;

    const nameCell = row.find('td.name').first();
    const link = (nameCell.length ? nameCell : row).find('a[href*="/torrent/"]').first();
    const href = link.attr('href');
    if (!href) return;

    const id = torrentIdFromUrl(href);
    const pageUrl = absoluteUrl(href, baseUrl);
    const title = collapse(link.text());
    if (!id || !pageUrl || !title || seen.has(id)) return;
    seen.add(id);

    const uploaderLink = row.find('td.uploader a').first();
    const uploader = collapse(uploaderLink.text());
    const uploaderHref = uploaderLink.attr('href');
    const labels = rowLabels(nameCell.find('a.icon').first());

    // The official site badges verified and VIP uploaders; the copycat mirrors
    // strip them, so this stays optional rather than becoming a hard signal.
    const trusted = nameCell
      .find('i, span')
      .toArray()
      .some((node) => {
        const classes = $(node).attr('class') ?? '';
        return /\b(flaticon-)?(trust|vip|verified)\b/i.test(classes);
      });

    results.push({
      id,
      title,
      pageUrl,
      category: labels.category,
      type: labels.type,
      trusted: trusted || undefined,
      sizeBytes: parseSizeToBytes(cellText(row.find('td.size').first())),
      seeders: parseCount(cellText(row.find('td.seeds').first())),
      leechers: parseCount(cellText(row.find('td.leeches').first())),
      uploadedAt: parseTorrentDate(cellText(row.find('td.coll-date').first()), now),
      uploader: uploader || undefined,
      uploaderUrl: uploaderHref ? absoluteUrl(uploaderHref, baseUrl) : undefined,
    });
  });

  return results;
}

// ------------------------------------------------------------ detail page

/**
 * 1337x lays its metadata out as `<li><strong>Label</strong><span>value</span></li>`.
 * Matched on a label prefix so a renamed suffix ("Uploaded By" -> "Uploaded by")
 * does not lose the field.
 */
function labelledValue($: CheerioAPI, label: string): string | undefined {
  const needle = label.toLowerCase();
  let found: string | undefined;

  $('ul.list li').each((_, element) => {
    if (found !== undefined) return;
    const item = $(element);
    const strong = collapse(item.find('strong').first().text()).toLowerCase();
    if (!strong.startsWith(needle)) return;

    const value = collapse(item.find('span').first().text());
    if (value) found = value;
  });

  return found;
}

function labelledLink($: CheerioAPI, label: string): { text?: string; href?: string } {
  const needle = label.toLowerCase();
  let result: { text?: string; href?: string } = {};

  $('ul.list li').each((_, element) => {
    if (result.text !== undefined) return;
    const item = $(element);
    const strong = collapse(item.find('strong').first().text()).toLowerCase();
    if (!strong.startsWith(needle)) return;

    const link = item.find('span a').first();
    const text = collapse(link.length ? link.text() : item.find('span').first().text());
    if (text) result = { text, href: link.attr('href') };
  });

  return result;
}

/** `Some.File.mkv (1.4 GB)` -> name and size, the way the reference splits it. */
function splitFileEntry(raw: string): { name: string; sizeBytes?: number } {
  const text = collapse(raw);
  const match = /\(([^)]*\d[^)]*)\)$/.exec(text);
  if (!match) return { name: text };

  const sizeBytes = parseSizeToBytes(match[1]);
  if (sizeBytes === undefined) return { name: text };

  return { name: text.slice(0, match.index).trim(), sizeBytes };
}

function fileType(classes?: string): string | undefined {
  if (!classes) return undefined;
  for (const token of classes.split(/\s+/)) {
    if (token.startsWith('flaticon-')) return token.slice('flaticon-'.length) || undefined;
  }
  return undefined;
}

/**
 * Builds the details for one torrent page.
 *
 * Only two things are fatal: a page that is not a torrent page at all, and a
 * page with neither a magnet nor an infohash — which is the same pair the
 * reference treats as a failed scrape. Every other field is optional.
 */
export function parse1337xDetails(
  html: string,
  pageUrl: string,
  fallbackId?: number,
  now: Date = new Date(),
): Torrent1337xDetails {
  if (is1337xChallengePage(html)) {
    throw new Torrent1337xError(
      '1337x is serving an anti-bot check right now, so that page cannot be read. Try again later.',
    );
  }
  if (is1337xNotFoundPage(html)) {
    throw new Torrent1337xError('That torrent does not exist on 1337x.');
  }

  const $ = cheerio.load(html);

  const title = collapse(
    $('.box-info-heading h1').first().text() || $('.page-content h1').first().text(),
  );

  const magnetHref = $('a[href^="magnet:"]').first().attr('href');
  const magnet = magnetHref ? magnetHref.trim() : undefined;

  const infoHashText = collapse($('.infohash-box span').first().text()).replace(/[^a-z0-9]/gi, '');
  const infoHash = /^[a-f0-9]{40}$/i.test(infoHashText)
    ? infoHashText.toUpperCase()
    : infoHashFromMagnet(magnet);

  if (!title && !magnet && !infoHash) {
    throw new Torrent1337xError('That page does not look like a 1337x torrent page.');
  }
  if (!magnet && !infoHash) {
    throw new Torrent1337xError('That torrent page has no magnet link or infohash.');
  }

  const id = torrentIdFromUrl(pageUrl) ?? fallbackId ?? 0;

  const uploaderInfo = labelledLink($, 'uploaded by');

  const trackers = dedupeTrackers(
    $('#tracker-list li')
      .map((_, element) => $(element).text())
      .get(),
  );

  const files: Torrent1337xFile[] = [];
  $('#files')
    .find('li, span.head')
    .each((_, element) => {
      if (files.length >= MAX_FILES) return;
      const node = $(element);
      const { name, sizeBytes } = splitFileEntry(node.text());
      if (!name) return;
      files.push({ type: fileType(node.find('i, span').first().attr('class')), name, sizeBytes });
    });

  const detail = $('.torrent-detail').first();
  const cover = absoluteUrl(detail.find('.torrent-image img').first().attr('src'), pageUrl);
  const ratingStyle = detail.find('span.rating i').first().attr('style');
  const rating = parseCount(/width:\s*(\d+)/i.exec(ratingStyle ?? '')?.[1]);

  const categoryBlock = detail.find('.torrent-category').first();
  const metadataCategories = categoryBlock
    .find('span')
    .map((_, element) => collapse($(element).text()))
    .get()
    .filter(Boolean);

  const descriptionHtml = $('#description').first().html();

  return {
    id,
    title: title || `Torrent ${id}`,
    pageUrl,
    magnet,
    infoHash,
    category: labelledValue($, 'category'),
    type: labelledValue($, 'type'),
    language: labelledValue($, 'language'),
    sizeBytes: parseSizeToBytes(labelledValue($, 'total size')),
    uploader: uploaderInfo.text,
    uploaderUrl: uploaderInfo.href ? absoluteUrl(uploaderInfo.href, pageUrl) : undefined,
    downloads: parseCount(labelledValue($, 'downloads')),
    uploadedAt: parseTorrentDate(labelledValue($, 'date uploaded'), now),
    checkedAt: parseTorrentDate(labelledValue($, 'last checked'), now),
    seeders: parseCount(labelledValue($, 'seeders')),
    leechers: parseCount(labelledValue($, 'leechers')),
    description: plainText(descriptionHtml) || undefined,
    trackers,
    files,
    coverUrl: cover,
    rating,
    metadataTitle: collapse(detail.find('h1, h2, h3, h4, h5, h6').first().text()) || undefined,
    metadataCategories,
    metadataDescription: collapse(categoryBlock.find('p').first().text()) || undefined,
  };
}
