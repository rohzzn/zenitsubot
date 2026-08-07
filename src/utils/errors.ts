import { logger } from '../services/logger.js';
import { HttpError } from './http.js';

/**
 * Turning a thrown thing into something worth reading.
 *
 * Every failure used to surface as "There was an error executing this command."
 * That sentence costs the reader a support message to learn what the bot
 * already knew: whether to try again, wait, fix their input, or report a bug.
 *
 * The classes below carry that distinction. Anything that escapes unclassified
 * is treated as a genuine bug and gets an id, so a report can be matched to the
 * log line instead of described from memory.
 */

/** A remote service the bot depends on failed or timed out. Retrying may work. */
export class UpstreamError extends Error {
  constructor(
    public readonly service: string,
    message?: string,
  ) {
    super(message ?? `${service} did not respond.`);
    this.name = 'UpstreamError';
  }
}

/** A quota was hit. `retryAfterSeconds` is shown when the service tells us. */
export class RateLimitError extends Error {
  constructor(
    public readonly service: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`${service} is rate limited.`);
    this.name = 'RateLimitError';
  }
}

/** The user asked for something impossible. Their move, not ours. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/** The request was fine but there was nothing to show. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface ExplainedError {
  /** What the user sees. */
  message: string;
  /** Set for unclassified failures; matches the `errorId` in the log. */
  id?: string;
  /** True when trying the same thing again is reasonable. */
  retryable: boolean;
}

function short(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

/**
 * Builds a reference an error report can be matched on.
 *
 * Deliberately short and unambiguous to read aloud or retype: no vowels means
 * no accidental words, and the alphabet excludes characters that look alike in
 * Discord's font.
 */
function errorId(): string {
  const alphabet = '23456789BCDFGHJKLMNPQRSTVWXZ';
  let id = '';
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

/**
 * Classifies a thrown value and logs it at a level that matches what it is.
 *
 * User errors are not logged as failures — they are the system working. Only
 * genuine bugs get an error-level line, which keeps `/logs` readable.
 */
export function explain(err: unknown, context: Record<string, unknown> = {}): ExplainedError {
  if (err instanceof UserError) {
    return { message: err.message, retryable: false };
  }

  if (err instanceof NotFoundError) {
    return { message: err.message, retryable: false };
  }

  if (err instanceof RateLimitError) {
    const wait = err.retryAfterSeconds ? ` Try again in ${short(err.retryAfterSeconds)}.` : '';
    logger.info({ ...context, service: err.service }, 'Rate limited');
    return { message: `${err.service} is rate limiting us right now.${wait}`, retryable: true };
  }

  if (err instanceof UpstreamError) {
    logger.warn({ ...context, service: err.service }, 'Upstream failure');
    return {
      message: `${err.service} is not responding. This is on their end — try again shortly.`,
      retryable: true,
    };
  }

  // Anything that went through fetchJson arrives already carrying a status,
  // which is enough to classify it without every service doing so by hand.
  if (err instanceof HttpError) {
    if (err.status === 429) {
      return explain(new RateLimitError(err.host, err.retryAfterSeconds), context);
    }
    if (err.status >= 500) {
      return explain(new UpstreamError(err.host), context);
    }
    if (err.status === 401 || err.status === 403) {
      logger.warn({ ...context, status: err.status, host: err.host }, 'Upstream refused us');
      return {
        message: `${err.host} refused the request. The bot may be missing an API key for it.`,
        retryable: false,
      };
    }
    logger.warn({ ...context, status: err.status, host: err.host }, 'Upstream rejected request');
    return { message: `${err.host} rejected that request (${err.status}).`, retryable: false };
  }

  // A timeout in fetchJson surfaces as an abort with no error code, so it has
  // to be matched by name or it falls through to "something broke on our side".
  if ((err as { name?: string } | null)?.name === 'AbortError') {
    logger.warn(context, 'Request timed out');
    return { message: 'That took too long and was given up on. Try again.', retryable: true };
  }

  // Network-shaped failures from undici/node that nobody wrapped.
  const code = (err as { code?: string } | null)?.code;
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT'
  ) {
    logger.warn({ ...context, code }, 'Network failure');
    return {
      message: 'Could not reach the service this command depends on. Try again shortly.',
      retryable: true,
    };
  }

  const id = errorId();
  logger.error({ ...context, err, errorId: id }, 'Unhandled command failure');
  return {
    message: `Something broke on our side. Quote \`${id}\` if you report it.`,
    id,
    retryable: false,
  };
}
