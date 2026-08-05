import { Client } from 'discord.js';
import { Shoukaku, Connectors, Node } from 'shoukaku';
import { loadConfig } from '../services/config.js';
import { logger } from '../services/logger.js';

export let shoukaku: Shoukaku | null = null;

export function createLavalink(client: Client): Shoukaku {
  const cfg = loadConfig();
  const nodes = [
    {
      name: 'primary',
      url: `${cfg.LAVALINK_HOST}:${cfg.LAVALINK_PORT}`,
      auth: cfg.LAVALINK_PASSWORD,
      secure: false,
    },
  ];

  const manager = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: Infinity,
    moveOnDisconnect: true,
  });

  manager.on('ready', (name) => logger.info({ node: name }, 'Lavalink node connected'));
  manager.on('error', (name, err) => logger.error({ node: name, err }, 'Lavalink error'));
  manager.on('close', (name, code, reason) =>
    logger.warn({ node: name, code, reason }, 'Lavalink node closed'),
  );

  shoukaku = manager;
  return manager;
}

export async function search(node: Node, query: string) {
  const res = await node.rest.resolve(query);
  return res; // { loadType, tracks, playlist }
}
