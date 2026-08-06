import type { Client, Guild } from 'discord.js';
import { getPrisma } from '../services/db.js';
import { logger } from '../services/logger.js';
import { COMMANDS } from '../commands/index.js';

export function registerGuildCreateListener(client: Client) {
  client.on('guildCreate', async (guild: Guild) => {
    try {
      await getPrisma().guildConfig.upsert({
        where: { guildId: guild.id },
        update: {},
        create: { guildId: guild.id },
      });
    } catch (err) {
      logger.error({ err, guild: guild.id }, 'Failed to upsert guild config');
    }

    // Commands are registered per guild rather than globally, because
    // registering both makes every command appear twice in the picker. That
    // means a newly joined guild has none until we push them here.
    try {
      await guild.commands.set(COMMANDS.map((c) => c.builder.toJSON()));
      logger.info(
        { guild: guild.id, name: guild.name, count: COMMANDS.length },
        'Joined guild and registered commands',
      );
    } catch (err) {
      logger.error({ err, guild: guild.id }, 'Failed to register commands for new guild');
    }
  });
}
