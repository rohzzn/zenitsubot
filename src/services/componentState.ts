import { getPrisma } from './db.js';
import { logger } from './logger.js';

/**
 * Persistent state for message components.
 *
 * The bot used to drive its buttons with `createMessageComponentCollector`,
 * which lives in process memory. Every deploy therefore killed every button in
 * every message the bot had ever sent — clicking one returned "This interaction
 * failed" with no explanation. Menus also died silently on a timeout while the
 * message they belonged to stayed on screen looking operable.
 *
 * Keying state to the message id fixes both. The router looks the row up when a
 * click arrives, so a restart is invisible and the only thing that ends a
 * message's life is the expiry we chose.
 *
 * An in-process cache sits in front because the common case is someone clicking
 * through a message that is still on screen, and that should not hit SQLite
 * every time.
 */

const MAX_PAYLOAD_BYTES = 400_000; // SQLite is fine with this; runaway state is not
const CACHE_LIMIT = 200;

export interface ComponentState<T = unknown> {
  kind: string;
  ownerId: string;
  payload: T;
}

const cache = new Map<string, ComponentState>();

function remember(messageId: string, state: ComponentState): void {
  // Cheapest useful eviction: Map preserves insertion order, so the first key
  // is the oldest write.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(messageId, state);
}

/**
 * Stores the state a message's components need to keep working.
 *
 * `ttlMs` is how long the controls stay live. Prefer generous values — the
 * whole point is that a message found by scrolling back still works.
 */
export async function saveState<T>(
  messageId: string,
  kind: string,
  ownerId: string,
  payload: T,
  ttlMs: number,
): Promise<void> {
  const serialised = JSON.stringify(payload);

  if (serialised.length > MAX_PAYLOAD_BYTES) {
    // Better to lose the controls than to fill the database with one message's
    // worth of state; the command still rendered fine.
    logger.warn({ kind, bytes: serialised.length }, 'Component state too large; not persisting');
    return;
  }

  remember(messageId, { kind, ownerId, payload });

  const expiresAt = new Date(Date.now() + ttlMs);

  try {
    await getPrisma().componentState.upsert({
      where: { messageId },
      create: { messageId, kind, ownerId, payload: serialised, expiresAt },
      update: { kind, ownerId, payload: serialised, expiresAt },
    });
  } catch (err) {
    // A message whose state failed to persist still works until the next
    // restart, so this is worth logging but not worth failing the command over.
    logger.warn({ err, kind }, 'Could not persist component state');
  }
}

/** Returns null when the message is unknown, expired, or was never ours. */
export async function loadState<T>(
  messageId: string,
  kind: string,
): Promise<ComponentState<T> | null> {
  const cached = cache.get(messageId);
  if (cached) return cached.kind === kind ? (cached as ComponentState<T>) : null;

  try {
    const row = await getPrisma().componentState.findUnique({ where: { messageId } });
    if (!row || row.kind !== kind) return null;

    if (row.expiresAt.getTime() < Date.now()) {
      void getPrisma()
        .componentState.delete({ where: { messageId } })
        .catch(() => {});
      return null;
    }

    const state: ComponentState<T> = {
      kind: row.kind,
      ownerId: row.ownerId,
      payload: JSON.parse(row.payload) as T,
    };
    remember(messageId, state as ComponentState);
    return state;
  } catch (err) {
    logger.warn({ err, kind }, 'Could not read component state');
    return null;
  }
}

export async function clearState(messageId: string): Promise<void> {
  cache.delete(messageId);
  await getPrisma()
    .componentState.delete({ where: { messageId } })
    .catch(() => {});
}

/** Drops rows whose controls have expired. Called on a timer from ready. */
export async function pruneExpiredState(): Promise<number> {
  try {
    const { count } = await getPrisma().componentState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count) logger.debug({ count }, 'Pruned expired component state');
    return count;
  } catch (err) {
    logger.warn({ err }, 'Could not prune component state');
    return 0;
  }
}
