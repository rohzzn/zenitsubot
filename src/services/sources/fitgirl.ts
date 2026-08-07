import * as cheerio from 'cheerio';

import { fetchText } from './http.js';
import { parseSizeToBytes } from '../1337xParse.js';
import type { SourceResult, TorrentSource } from './types.js';

/**
 * FitGirl repacks.
 *
 * Not an index at all — one person's site, where every entry is a hand-made
 * compressed build of a game. That is exactly why it belongs here: a repack is
 * usually a third the size of the release it came from, and the general
 * indexes list mirrors of these without saying which are the real ones.
 *
 * It costs a second request to open a result, because the magnet lives on the
 * post rather than in the listing. Only 1337x shares that shape.
 */

const SITE = 'https://fitgirl-repacks.site';

/**
 * Posts that are not a game. The site mixes announcements and update
 * round-ups into the same feed as the repacks themselves.
 */
const NOT_A_REPACK =
  /^(updates? digest|upcoming repacks?|all my repacks|donations?|faq|contacts?)/i;

/** Search results carry only a title and a link; everything else is on the post. */
export function parseFitGirlSearch(html: string): SourceResult[] {
  const $ = cheerio.load(html);
  const results: SourceResult[] = [];
  const seen = new Set<string>();

  $('h1.entry-title a, h2.entry-title a').each((_, element) => {
    const link = $(element);
    const href = link.attr('href');
    const title = link.text().replace(/\s+/g, ' ').trim();

    if (!href || !title || NOT_A_REPACK.test(title)) return;
    if (!href.startsWith(SITE) || seen.has(href)) return;
    seen.add(href);

    // The slug is the only stable identifier the site offers.
    const slug = href.replace(`${SITE}/`, '').replace(/\/+$/, '');

    results.push({
      source: 'fitgirl',
      id: slug || href,
      title,
      pageUrl: href,
      category: 'Games',
      type: 'Repack',
      // One person, every release checked by hand: the closest thing to a
      // verified uploader that a site with no uploaders can have.
      trusted: true,
    });
  });

  return results;
}

/**
 * The magnet and the sizes from a repack post.
 *
 * Posts carry more than one magnet — the repack and its mirrors — and the
 * first is the one the site leads with.
 */
export function parseFitGirlPost(html: string): {
  magnet?: string;
  infoHash?: string;
  sizeBytes?: number;
  originalSizeBytes?: number;
} {
  // Hrefs arrive HTML-escaped, so `&#038;` has to become `&` before the
  // magnet is anything a torrent client will accept.
  const decoded = html.replace(/&#0?38;/g, '&').replace(/&amp;/g, '&');

  const magnet = /magnet:\?xt=urn:btih:[A-Za-z0-9]{32,40}[^"'\s<)]*/.exec(decoded)?.[0];
  const infoHash = /urn:btih:([A-Za-z0-9]{40})/.exec(magnet ?? '')?.[1]?.toUpperCase();

  const repack = /Repack Size:?[^0-9]{0,40}([\d.,]+\s*[KMGT]B)/i.exec(html)?.[1];
  const original = /Original Size:?[^0-9]{0,40}([\d.,]+\s*[KMGT]B)/i.exec(html)?.[1];

  return {
    magnet,
    infoHash,
    sizeBytes: parseSizeToBytes(repack),
    originalSizeBytes: parseSizeToBytes(original),
  };
}

/** Fills in what only the post knows. Used when a result is opened. */
export async function enrichFitGirlResult(result: SourceResult): Promise<SourceResult> {
  const html = await fetchText('fitgirl', result.pageUrl);
  const post = parseFitGirlPost(html);

  return {
    ...result,
    magnet: post.magnet ?? result.magnet,
    infoHash: post.infoHash ?? result.infoHash,
    sizeBytes: post.sizeBytes ?? result.sizeBytes,
  };
}

export const fitGirlSource: TorrentSource = {
  id: 'fitgirl',
  label: 'FitGirl Repacks',
  blurb: 'Hand-made compressed game repacks, far smaller than the originals',
  categories: ['Games'],
  // Off by default: it answers only about games, and every result it returns
  // costs an extra request to open.
  enabledByDefault: false,

  async search({ query, limit }) {
    const params = new URLSearchParams({ s: query });
    const html = await fetchText('fitgirl', `${SITE}/?${params}`);

    return parseFitGirlSearch(html).slice(0, limit);
  },
};
