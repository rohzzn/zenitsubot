import type { Client } from 'discord.js';
import { logger } from '../services/logger.js';
import { pruneExpiredState } from '../services/componentState.js';

/** Component state outlives the process by design, so something has to sweep it. */
const STATE_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Startup does NOT register slash commands.
 *
 * This listener used to hold its own hardcoded copy of the command list and
 * PUT it to Discord on every boot, silently overwriting whatever
 * `npm run register:commands` had pushed. Any command added to the registry
 * worked until the next restart and then vanished, and where the two lists
 * disagreed on option names, commands broke at runtime.
 *
 * Registration is now a deliberate, explicit step:
 *   npm run verify:commands    # check registry, handlers and Discord agree
 *   npm run register:commands  # push the registry to Discord
 */
export function registerReadyListener(client: Client) {
  // 'ready' is deprecated in discord.js v14 and gone in v15.
  client.once('clientReady', () => {
    logger.info(
      {
        user: client.user?.tag,
        guilds: client.guilds.cache.size,
        commands: client.commands?.size ?? 0,
      },
      'Bot ready',
    );

    void pruneExpiredState();
    setInterval(() => void pruneExpiredState(), STATE_PRUNE_INTERVAL_MS).unref();
  });
}
