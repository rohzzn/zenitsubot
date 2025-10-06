import { Client, GatewayIntentBits, Partials, Collection, REST, Routes } from 'discord.js';
import { loadConfig } from './services/config.js';
import { logger } from './services/logger.js';
import { getPrisma } from './services/db.js';
import { initPlayerManager, PlayerManager } from './music/index.js';
import './web/server.js';

// Types for command handling
export interface SlashCommand {
  data: { name: string }; // minimal for runtime, full builder used in register script
  execute: (client: Client, interaction: any) => Promise<void>;
  category?: string;
  defaultMemberPermissions?: bigint | undefined;
}

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, SlashCommand>;
    playerManager: PlayerManager;
  }
}

async function main() {
  const config = loadConfig();
  getPrisma();

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

  // Attach command collection
  client.commands = new Collection<string, SlashCommand>();
  // Initialize and attach the player manager once
  client.playerManager = initPlayerManager(client);

  // Register listeners
  const { registerReadyListener } = await import('./listeners/ready.js');
  const { registerInteractionCreateListener } = await import('./listeners/interactionCreate.js');
  const { registerGuildCreateListener } = await import('./listeners/guildCreate.js');
  const { registerGuildDeleteListener } = await import('./listeners/guildDelete.js');
  const { registerVoiceStateListener } = await import('./listeners/voiceStateUpdate.js');
  const { default: registerButtonHandler } = await import('./listeners/buttonInteraction.js');

  registerReadyListener(client);
  registerInteractionCreateListener(client);
  registerGuildCreateListener(client);
  registerGuildDeleteListener(client);
  registerVoiceStateListener(client);
  registerButtonHandler(client);

  // Load commands
  const { ping } = await import('./commands/slash/ping.js');
  const { help } = await import('./commands/slash/help.js');
  
  // Music commands
  const { join } = await import('./commands/slash/music/join.js');
  const { play } = await import('./commands/slash/music/play.js');
  const { pause } = await import('./commands/slash/music/pause.js');
  const { resume } = await import('./commands/slash/music/resume.js');
  const { skip } = await import('./commands/slash/music/skip.js');
  const { stop } = await import('./commands/slash/music/stop.js');
  const { queue } = await import('./commands/slash/music/queue.js');
  const { now } = await import('./commands/slash/music/now.js');
  const { volume } = await import('./commands/slash/music/volume.js');
  const { loop } = await import('./commands/slash/music/loop.js');
  const { shuffle } = await import('./commands/slash/music/shuffle.js');
  
  // Moderation commands
  const { kick } = await import('./commands/slash/mod/kick.js');
  const { ban } = await import('./commands/slash/mod/ban.js');
  const { mute } = await import('./commands/slash/mod/mute.js');
  const { purge } = await import('./commands/slash/mod/purge.js');
  
  // Utility commands
  const { avatar } = await import('./commands/slash/util/avatar.js');
  const { server } = await import('./commands/slash/util/server.js');
  const { user } = await import('./commands/slash/util/user.js');
  
  // Anime commands
  const { anime } = await import('./commands/slash/anime/anime.js');
  const { animesearch } = await import('./commands/slash/anime/search.js');
  const { animeinfo } = await import('./commands/slash/anime/info.js');
  const { animeupcoming } = await import('./commands/slash/anime/upcoming.js');
  const { animecharacter } = await import('./commands/slash/anime/character.js');
  const { animealert } = await import('./commands/slash/anime/alert.js');
  
  // Economy commands
  const { balance } = await import('./commands/slash/economy/balance.js');
  const { daily } = await import('./commands/slash/economy/daily.js');
  const { leaderboard } = await import('./commands/slash/economy/leaderboard.js');
  
  // Fun commands
  const { eightball } = await import('./commands/slash/fun/8ball.js');
  const { blackjack } = await import('./commands/slash/fun/blackjack.js');
  const { animequote } = await import('./commands/slash/fun/animequote.js');
  const { icebreaker } = await import('./commands/slash/fun/icebreaker.js');
  
  // Admin commands
  const { welcome } = await import('./commands/slash/admin/welcome.js');
  const { streamalert } = await import('./commands/slash/admin/streamalert.js');

  client.commands.set(ping.data.name, ping);
  client.commands.set(help.data.name, help);
  client.commands.set(join.data.name, join);
  client.commands.set(play.data.name, play);
  client.commands.set(pause.data.name, pause);
  client.commands.set(resume.data.name, resume);
  client.commands.set(skip.data.name, skip);
  client.commands.set(stop.data.name, stop);
  client.commands.set(queue.data.name, queue);
  client.commands.set(now.data.name, now);
  client.commands.set(volume.data.name, volume);
  client.commands.set(loop.data.name, loop);
  client.commands.set(shuffle.data.name, shuffle);
  client.commands.set(kick.data.name, kick);
  client.commands.set(ban.data.name, ban);
  client.commands.set(mute.data.name, mute);
  client.commands.set(purge.data.name, purge);
  client.commands.set(avatar.data.name, avatar);
  client.commands.set(server.data.name, server);
  client.commands.set(user.data.name, user);
  client.commands.set(anime.data.name, anime);
  client.commands.set(animesearch.data.name, animesearch);
  client.commands.set(animeinfo.data.name, animeinfo);
  client.commands.set(animeupcoming.data.name, animeupcoming);
  client.commands.set(animecharacter.data.name, animecharacter);
  client.commands.set(animealert.data.name, animealert);
  client.commands.set(balance.data.name, balance);
  client.commands.set(daily.data.name, daily);
  client.commands.set(leaderboard.data.name, leaderboard);
  client.commands.set(eightball.data.name, eightball);
  client.commands.set(blackjack.data.name, blackjack);
  client.commands.set(animequote.data.name, animequote);
  client.commands.set(icebreaker.data.name, icebreaker);
  client.commands.set(welcome.data.name, welcome);
  client.commands.set(streamalert.data.name, streamalert);

  // Start anime episode checker
  const { startAnimeChecker } = await import('./services/animeChecker.js');
  
  // Global process error handling
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'UnhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'UncaughtException');
  });

  await client.login(config.DISCORD_BOT_TOKEN);
  
  // Start anime checker after login
  client.once('ready', () => {
    startAnimeChecker(client);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal boot error');
  process.exit(1);
});


