import { logger } from '../logger.js';
import {
  countMatchingTerms,
  essentialTerms,
  matchesAllTerms,
  rankByRelevance,
} from '../1337xParse.js';
import { leetxSource } from './leetx.js';
import { nyaaSource } from './nyaa.js';
import { pirateBaySource } from './piratebay.js';
import { solidTorrentsSource } from './solidtorrents.js';
import { enrichFitGirlResult, fitGirlSource } from './fitgirl.js';
import type { SourceId, SourceResult, TorrentSource } from './types.js';

export type { SourceId, SourceResult, SourceCategory, TorrentSource } from './types.js';
export { magnetFromHash, PUBLIC_TRACKERS } from './types.js';
export { SourceError } from './http.js';

/**
 * Every index the bot can search, in the order their results are preferred
 * when the same release turns up on more than one.
 *
 * 1337x leads because its rows carry an uploader and a real upload date;
 * The Pirate Bay follows because it is the broadest. The order only decides
 * which copy of a duplicate survives, not which results appear.
 */
export const SOURCES: TorrentSource[] = [
  leetxSource,
  pirateBaySource,
  nyaaSource,
  solidTorrentsSource,
  fitGirlSource,
];

/** Asked on a plain search: the two broad indexes, nothing specialised. */
export const DEFAULT_SOURCE_IDS: SourceId[] = SOURCES.filter(
  (source) => source.enabledByDefault,
).map((source) => source.id);

export function sourceById(id: string): TorrentSource | undefined {
  return SOURCES.find((source) => source.id === id);
}

/** Whether a source has anything to say about this category. */
function answers(source: TorrentSource, category?: string): boolean {
  if (!category) return true;
  if (source.categories === 'all') return true;
  return source.categories.some((known) => known.toLowerCase() === category.toLowerCase());
}

/** Sources that can actually answer a question about this category. */
export function sourcesFor(category?: string, ids?: SourceId[]): TorrentSource[] {
  const pool = ids ? SOURCES.filter((source) => ids.includes(source.id)) : SOURCES;
  return pool.filter((source) => answers(source, category));
}

export interface AggregateOptions {
  query: string;
  category?: string;
  /**
   * Exactly which indexes to ask. Omitted means the default pair, which is
   * what a plain search gets.
   */
  sources?: SourceId[];
  limit: number;
  sort?: 'relevance' | 'recent';
}

export interface AggregateOutcome {
  results: SourceResult[];
  /** Sources that answered, and what each contributed before merging. */
  contributions: Array<{ id: SourceId; label: string; found: number }>;
  failures: Array<{ id: SourceId; label: string; reason: string }>;
}

/**
 * Identity for the same release found twice.
 *
 * The infohash is exact and most sources supply it. 1337x does not, so its
 * rows fall back to title and size — the same key the mirror merge already
 * uses.
 */
function identity(result: SourceResult): string {
  if (result.infoHash) return `hash:${result.infoHash.toUpperCase()}`;

  const title = result.title.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
  return `name:${title}|${result.sizeBytes ?? 0}`;
}

/**
 * One release, assembled from every copy of it that was found.
 *
 * Different indexes know different things about the same torrent — 1337x has
 * the uploader, The Pirate Bay has the seeder count that is actually current.
 * Merging keeps the best of each rather than discarding a duplicate wholesale.
 */
function merge(into: SourceResult, other: SourceResult): SourceResult {
  return {
    ...into,
    infoHash: into.infoHash ?? other.infoHash,
    magnet: into.magnet ?? other.magnet,
    category: into.category ?? other.category,
    type: into.type ?? other.type,
    sizeBytes: into.sizeBytes ?? other.sizeBytes,
    // Swarm numbers: take the healthier reading rather than an arbitrary one.
    seeders: Math.max(into.seeders ?? 0, other.seeders ?? 0) || undefined,
    leechers: Math.max(into.leechers ?? 0, other.leechers ?? 0) || undefined,
    downloads: into.downloads ?? other.downloads,
    uploadedAt: into.uploadedAt ?? other.uploadedAt,
    uploader: into.uploader ?? other.uploader,
    trusted: into.trusted || other.trusted,
  };
}

/**
 * Orders the merged list so `limit` cannot silently exclude a whole source.
 *
 * Each index is sorted by swarm health on its own, then they are taken in
 * turn. Sorting the pooled list instead would let one busy index fill every
 * place — and would bury any source that does not publish seeder counts, since
 * "unknown" would sort as "none". The caller re-ranks for display, so this
 * only decides which results survive the cut, not the order they appear in.
 */
function interleave(results: SourceResult[]): SourceResult[] {
  const bySource = new Map<SourceId, SourceResult[]>();

  for (const result of results) {
    const group = bySource.get(result.source) ?? [];
    group.push(result);
    bySource.set(result.source, group);
  }

  for (const group of bySource.values()) {
    group.sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));
  }

  const groups = [...bySource.values()];
  const ordered: SourceResult[] = [];

  for (let round = 0; ordered.length < results.length; round++) {
    for (const group of groups) {
      const next = group[round];
      if (next) ordered.push(next);
    }
  }

  return ordered;
}

/**
 * Searches every applicable index at once and returns one merged list.
 *
 * Sources are independent: a dead one resolves alongside the others instead of
 * delaying them, and only an empty result from all of them is a failure.
 */
export async function searchSources(options: AggregateOptions): Promise<AggregateOutcome> {
  const candidates = sourcesFor(options.category, options.sources ?? DEFAULT_SOURCE_IDS);

  const settled = await Promise.allSettled(
    candidates.map(async (source) => ({
      source,
      results: await source.search({
        query: options.query,
        category: options.category,
        limit: options.limit,
        sort: options.sort,
      }),
    })),
  );

  const contributions: AggregateOutcome['contributions'] = [];
  const failures: AggregateOutcome['failures'] = [];
  const merged = new Map<string, SourceResult>();

  for (const [index, outcome] of settled.entries()) {
    const source = candidates[index]!;

    if (outcome.status === 'rejected') {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : 'failed';
      failures.push({ id: source.id, label: source.label, reason });
      logger.debug({ err: outcome.reason, source: source.id }, 'Torrent source failed');
      continue;
    }

    contributions.push({ id: source.id, label: source.label, found: outcome.value.results.length });

    for (const result of outcome.value.results) {
      const key = identity(result);
      const existing = merged.get(key);
      merged.set(key, existing ? merge(existing, result) : result);
    }
  }

  // Every source matches differently — some AND the words, some do not — so
  // relevance is decided here rather than trusted to each of them.
  const terms = essentialTerms(options.query);
  const all = [...merged.values()];

  const exact = interleave(all.filter((result) => matchesAllTerms(result.title, terms)));
  const partial = rankByRelevance(
    all.filter(
      (result) =>
        !matchesAllTerms(result.title, terms) && countMatchingTerms(result.title, terms) >= 1,
    ),
    terms,
  );

  logger.debug(
    {
      query: options.query,
      asked: candidates.length,
      merged: all.length,
      exact: exact.length,
      failures: failures.length,
    },
    'Multi-source search complete',
  );

  return {
    results: [...exact, ...partial].slice(0, options.limit),
    contributions,
    failures,
  };
}

/**
 * Fills in whatever a source only reveals when a result is opened.
 *
 * Most indexes hand over the infohash with the search results, so this is a
 * no-op for them. FitGirl keeps its magnets on the post, so opening one of its
 * results costs the one request this makes.
 */
export async function completeResult(result: SourceResult): Promise<SourceResult> {
  if (result.source === 'fitgirl' && !result.magnet) return enrichFitGirlResult(result);
  return result;
}
