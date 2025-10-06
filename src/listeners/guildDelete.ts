import type { Client, Guild } from 'discord.js';
import { logger } from '../services/logger.js';

export function registerGuildDeleteListener(client: Client) {
  client.on('guildDelete', async (guild: Guild) => {
    logger.info({ guild: guild.id }, 'Removed from guild');
  });
}


