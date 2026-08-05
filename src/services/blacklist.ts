import { getPrisma } from './db.js';
import { logger } from './logger.js';

/**
 * Blacklisted ids are cached in memory because they are consulted on every
 * single interaction — a database round trip per command would be wasteful.
 * Mutations go through the /blacklist command, which calls refreshBlacklist().
 */
let blocked = new Set<string>();

export async function refreshBlacklist(): Promise<void> {
  try {
    const entries = await getPrisma().blacklist.findMany({ select: { targetId: true } });
    blocked = new Set(entries.map((e) => e.targetId));
    logger.info({ count: blocked.size }, 'Blacklist loaded');
  } catch (err) {
    logger.error({ err }, 'Could not load blacklist');
  }
}

export function isBlacklisted(...ids: Array<string | null | undefined>): boolean {
  return ids.some((id) => Boolean(id) && blocked.has(id!));
}
