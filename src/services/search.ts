import { logger } from './logger.js';

/**
 * Web search via our own SearXNG instance.
 *
 * Self-hosted on purpose: DuckDuckGo serves a captcha to datacenter IPs, and
 * the public SearXNG instances either rate-limit aggressively or ship with the
 * JSON format disabled. The container is only reachable on the compose network.
 */
const SEARXNG_URL = process.env.SEARXNG_URL ?? 'http://searxng:8080';
const TIMEOUT_MS = 12_000;

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  engine?: string;
  publishedDate?: string;
}

interface SearxngResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    engine?: string;
    publishedDate?: string;
  }>;
  answers?: string[];
}

export interface SearchOptions {
  limit?: number;
  /** SearXNG category, e.g. "general", "news", "it", "science". */
  category?: string;
  /** Restrict by recency: day, week, month, year. */
  timeRange?: string;
}

export class SearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}

/** Collapses whitespace and trims a snippet to a sane length for prompts. */
function tidy(text: string, max = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function webSearch(
  query: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResult[]; answers: string[] }> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language: 'en',
    safesearch: '1',
  });

  if (options.category) params.set('categories', options.category);
  if (options.timeRange) params.set('time_range', options.timeRange);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${SEARXNG_URL}/search?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new SearchUnavailableError(`Search backend returned ${response.status}`);
    }

    const data = (await response.json()) as SearxngResponse;

    const results: SearchResult[] = (data.results ?? [])
      .filter((r) => r.url && r.title)
      .slice(0, options.limit ?? 8)
      .map((r) => ({
        title: tidy(r.title!, 160),
        url: r.url!,
        content: tidy(r.content ?? ''),
        engine: r.engine,
        publishedDate: r.publishedDate,
      }));

    return { results, answers: (data.answers ?? []).map((a) => tidy(a)) };
  } catch (err) {
    if (err instanceof SearchUnavailableError) throw err;

    const reason =
      err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'is unreachable';
    logger.error({ err, query }, 'Web search failed');
    throw new SearchUnavailableError(`The search backend ${reason}.`);
  } finally {
    // Without this the abort timer keeps the event loop alive for its full
    // duration after a fast response.
    clearTimeout(timer);
  }
}

/** Formats results as numbered context for a model prompt. */
export function asPromptContext(results: SearchResult[]): string {
  return results
    .map((r, i) => {
      const date = r.publishedDate ? ` (published ${r.publishedDate})` : '';
      return `[${i + 1}] ${r.title}${date}\nURL: ${r.url}\n${r.content}`;
    })
    .join('\n\n');
}
