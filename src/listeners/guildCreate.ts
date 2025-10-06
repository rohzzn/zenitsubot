import type { Client, Guild } from 'discord.js';
import { getPrisma } from '../services/db.js';
import { logger } from '../services/logger.js';

export function registerGuildCreateListener(client: Client) {
  client.on('guildCreate', async (guild: Guild) => {
    const prisma = getPrisma();
    try {
      await prisma.guildConfig.upsert({
        where: { guildId: guild.id },
        update: {},
        create: { guildId: guild.id },
      });
      logger.info({ guild: guild.id }, 'Joined guild and ensured config');
    } catch (err) {
      logger.error({ err, guild: guild.id }, 'Failed to upsert guild config');
    }
  });
}


