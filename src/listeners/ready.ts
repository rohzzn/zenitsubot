import type { Client } from 'discord.js';
import { logger } from '../services/logger.js';

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
  client.once('ready', () => {
    logger.info(
      {
        user: client.user?.tag,
        guilds: client.guilds.cache.size,
        commands: client.commands?.size ?? 0,
      },
      'Bot ready',
    );
  });
}
