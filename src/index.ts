import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { loadConfig } from './services/config.js';
import { logger } from './services/logger.js';
import { connectPrisma } from './services/db.js';
import { refreshBlacklist } from './services/blacklist.js';
import { initPlayerManager, PlayerManager } from './music/index.js';
import { COMMANDS, type CommandHandler } from './commands/index.js';
import './web/server.js';

export type SlashCommand = CommandHandler;

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, CommandHandler>;
    playerManager: PlayerManager;
  }
}

async function main() {
  const config = loadConfig();
  await connectPrisma();
  await refreshBlacklist();

  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ];

  if (config.MESSAGE_CONTENT_INTENT) intents.push(GatewayIntentBits.MessageContent);

  const client = new Client({
    intents,
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User],
  }) as Client;

  client.commands = new Collection<string, CommandHandler>();
  client.playerManager = initPlayerManager(client);

  for (const { handler } of COMMANDS) {
    client.commands.set(handler.data.name, handler);
  }
  logger.info({ count: client.commands.size }, 'Commands loaded');

  const { registerReadyListener } = await import('./listeners/ready.js');
  const { registerInteractionCreateListener } = await import('./listeners/interactionCreate.js');
  const { registerGuildCreateListener } = await import('./listeners/guildCreate.js');
  const { registerGuildDeleteListener } = await import('./listeners/guildDelete.js');
  const { registerVoiceStateListener } = await import('./listeners/voiceStateUpdate.js');
  const { registerMentionChatListener } = await import('./listeners/mentionChat.js');
  const { default: registerButtonHandler } = await import('./listeners/buttonInteraction.js');

  registerReadyListener(client);
  registerInteractionCreateListener(client);
  registerGuildCreateListener(client);
  registerGuildDeleteListener(client);
  registerVoiceStateListener(client);
  registerMentionChatListener(client);
  registerButtonHandler(client);

  const { startReminderScheduler } = await import('./services/reminderScheduler.js');
  const { startTorrentWatchScheduler } = await import('./services/torrentWatch.js');

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'UnhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'UncaughtException');
  });

  client.once('ready', () => {
    startReminderScheduler(client);
    startTorrentWatchScheduler(client);
  });

  await client.login(config.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal boot error');
  process.exit(1);
});
