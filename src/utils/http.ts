import { logger } from '../services/logger.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Several APIs (crates.io in particular) reject requests without one. */
export const USER_AGENT = 'ZenitsuBot (+https://github.com/rohzzn/zenitsubot)';

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class HttpError extends Error {
  /** The host, for error messages that need to name who failed. */
  readonly host: string;

  constructor(
    readonly status: number,
    url: string,
    /** Seconds, from the Retry-After header when the service sent one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(`Request to ${url} failed with ${status}`);
    this.name = 'HttpError';
    this.host = safeHost(url);
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the service';
  }
}

/** Retry-After is either a delay in seconds or an HTTP date. */
function retryAfter(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;

  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, (at - Date.now()) / 1000) : undefined;
}

/**
 * Fetches JSON with a hard timeout. Returns null on a 404 so callers can show
 * "not found" without treating it as a failure; other non-2xx statuses throw.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...options.headers },
      signal: controller.signal,
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new HttpError(response.status, url, retryAfter(response));

    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    logger.warn({ err, url }, 'fetchJson failed');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Collapses whitespace and trims to `max`, appending an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Discord relative timestamp, e.g. "3 months ago". */
export function relativeTime(date: string | number | Date): string {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`;
}
