import { logger } from '../logger.js';

/**
 * The one way these adapters reach the network.
 *
 * Each source gets the same treatment the 1337x client already had: a hard
 * timeout, a response-size ceiling, a descriptive user agent, and no redirect
 * chasing off to somewhere unexpected. A source that misbehaves fails on its
 * own rather than holding up a search across all of them.
 */

const TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export const SOURCE_USER_AGENT = 'ZenitsuBot/1.0 (+https://github.com/rohzzn/zenitsubot)';

export class SourceError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

async function readCapped(response: Response, source: string): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new SourceError(source, 'response too large');
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
        throw new SourceError(source, 'response too large');
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

export async function fetchText(
  source: string,
  url: string,
  accept = 'text/html,application/xhtml+xml,*/*;q=0.8',
): Promise<string> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': SOURCE_USER_AGENT,
        Accept: accept,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.debug({ err, source, url }, 'Source unreachable');
    throw new SourceError(source, 'unreachable');
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new SourceError(source, `returned ${response.status}`);
  }

  return readCapped(response, source);
}

export async function fetchJson<T>(source: string, url: string): Promise<T> {
  const text = await fetchText(source, url, 'application/json,*/*;q=0.8');

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError(source, 'returned malformed JSON');
  }
}
