import type { Client } from 'discord.js';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { loadConfig } from '../services/config.js';
import { logger } from '../services/logger.js';

export function registerReadyListener(client: Client) {
  client.once('ready', async () => {
    const guildCount = client.guilds.cache.size;
    const commandCount = client.commands?.size ?? 0;
    logger.info({ guildCount, commandCount }, 'Bot ready');

    // Auto-register commands on startup (global)
    try {
      const cfg = loadConfig();
      const rest = new REST({ version: '10' }).setToken(cfg.DISCORD_BOT_TOKEN);
      
      const commands = [
        // General
        new SlashCommandBuilder().setName('ping').setDescription('Show bot latency'),
        new SlashCommandBuilder().setName('help').setDescription('Show all commands'),
        
        // Music
        new SlashCommandBuilder().setName('join').setDescription('Join your voice channel'),
        new SlashCommandBuilder()
          .setName('play')
          .setDescription('Play a song (name, artist, YouTube, or Spotify URL)')
          .addStringOption((o) => o.setName('query').setDescription('Song name, artist, or URL').setRequired(true)),
        new SlashCommandBuilder().setName('pause').setDescription('Pause the player'),
        new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
        new SlashCommandBuilder().setName('skip').setDescription('Skip current track'),
        new SlashCommandBuilder().setName('stop').setDescription('Stop playback and leave voice'),
        new SlashCommandBuilder().setName('queue').setDescription('Show the current queue'),
        new SlashCommandBuilder().setName('now').setDescription('Show currently playing track'),
        new SlashCommandBuilder()
          .setName('volume')
          .setDescription('Set player volume (0-100)')
          .addIntegerOption((o) => o.setName('level').setDescription('Volume level').setRequired(true).setMinValue(0).setMaxValue(100)),
        new SlashCommandBuilder()
          .setName('loop')
          .setDescription('Set loop mode')
          .addStringOption((o) => 
            o.setName('mode').setDescription('Loop mode').setRequired(true)
              .addChoices(
                { name: 'Off', value: 'off' },
                { name: 'Track', value: 'track' },
                { name: 'Queue', value: 'queue' }
              )
          ),
        new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
        
        // Moderation
        new SlashCommandBuilder()
          .setName('kick')
          .setDescription('Kick a member')
          .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
          .addUserOption((o) => o.setName('user').setDescription('User to kick').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Reason for kick')),
        new SlashCommandBuilder()
          .setName('ban')
          .setDescription('Ban a member')
          .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
          .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Reason for ban')),
        new SlashCommandBuilder()
          .setName('mute')
          .setDescription('Timeout a member')
          .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
          .addUserOption((o) => o.setName('user').setDescription('User to mute').setRequired(true))
          .addIntegerOption((o) => o.setName('duration').setDescription('Duration in seconds').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Reason for mute')),
        new SlashCommandBuilder()
          .setName('purge')
          .setDescription('Bulk delete messages')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
          .addIntegerOption((o) => o.setName('count').setDescription('Number of messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
        
        // Utility
        new SlashCommandBuilder()
          .setName('avatar')
          .setDescription('Show user avatar')
          .addUserOption((o) => o.setName('user').setDescription('User (defaults to you)')),
        new SlashCommandBuilder().setName('server').setDescription('Show server info'),
        new SlashCommandBuilder()
          .setName('user')
          .setDescription('Show user info')
          .addUserOption((o) => o.setName('user').setDescription('User (defaults to you)')),
        
        // Anime
        new SlashCommandBuilder()
          .setName('anime')
          .setDescription('Anime commands - see all available anime features'),
        new SlashCommandBuilder()
          .setName('animesearch')
          .setDescription('Search for anime on MyAnimeList')
          .addStringOption((o) => o.setName('query').setDescription('Anime name to search').setRequired(true)),
        new SlashCommandBuilder()
          .setName('animeinfo')
          .setDescription('Get detailed anime info with reviews and ratings')
          .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true)),
        new SlashCommandBuilder()
          .setName('animeupcoming')
          .setDescription('See top 5 upcoming anime episodes airing soon'),
        new SlashCommandBuilder()
          .setName('animecharacter')
          .setDescription('Search for anime characters')
          .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true)),
        new SlashCommandBuilder()
          .setName('animairing')
          .setDescription('View currently airing anime this season'),
        new SlashCommandBuilder()
          .setName('animealert')
          .setDescription('Setup anime episode alerts')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
          .addSubcommand((sub) =>
            sub
              .setName('add')
              .setDescription('Add an anime to track')
              .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true))
              .addChannelOption((o) => o.setName('channel').setDescription('Alert channel').setRequired(true))
          )
          .addSubcommand((sub) =>
            sub
              .setName('remove')
              .setDescription('Remove an anime from tracking')
              .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true))
          )
          .addSubcommand((sub) => sub.setName('list').setDescription('List tracked anime')),
        
        // Economy
        new SlashCommandBuilder()
          .setName('balance')
          .setDescription('Check your or someone else\'s balance and level')
          .addUserOption((o) => o.setName('user').setDescription('User to check')),
        new SlashCommandBuilder()
          .setName('daily')
          .setDescription('Claim your daily coins!'),
        new SlashCommandBuilder()
          .setName('leaderboard')
          .setDescription('View server leaderboard')
          .addStringOption((o) => 
            o.setName('type').setDescription('Leaderboard type')
              .addChoices(
                { name: 'Coins', value: 'coins' },
                { name: 'Levels', value: 'levels' }
              )
          ),
        
        // Fun
        new SlashCommandBuilder()
          .setName('8ball')
          .setDescription('Ask Zenitsu a yes/no question')
          .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
        new SlashCommandBuilder()
          .setName('blackjack')
          .setDescription('Play blackjack and bet your coins!')
          .addIntegerOption((o) => o.setName('bet').setDescription('Amount to bet (10-10000)').setRequired(true).setMinValue(10).setMaxValue(10000)),
        new SlashCommandBuilder()
          .setName('animequote')
          .setDescription('Get an inspirational anime quote'),
        new SlashCommandBuilder()
          .setName('icebreaker')
          .setDescription('Get a random conversation starter'),
        
        // Admin
        new SlashCommandBuilder()
          .setName('welcome')
          .setDescription('Setup welcome messages')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
          .addSubcommand((sub) =>
            sub
              .setName('setup')
              .setDescription('Configure welcome messages')
              .addChannelOption((o) => o.setName('channel').setDescription('Welcome channel').setRequired(true))
              .addStringOption((o) => o.setName('message').setDescription('Custom message (use {user}, {server}, {memberCount})'))
          )
          .addSubcommand((sub) => sub.setName('disable').setDescription('Disable welcome messages'))
          .addSubcommand((sub) => sub.setName('test').setDescription('Test welcome message')),
        new SlashCommandBuilder()
          .setName('streamalert')
          .setDescription('Setup stream alerts')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
          .addSubcommand((sub) =>
            sub
              .setName('add')
              .setDescription('Add a stream alert')
              .addStringOption((o) => 
                o.setName('platform').setDescription('Platform').setRequired(true)
                  .addChoices(
                    { name: 'Twitch', value: 'twitch' },
                    { name: 'YouTube', value: 'youtube' }
                  )
              )
              .addStringOption((o) => o.setName('id').setDescription('Channel ID or username').setRequired(true))
              .addChannelOption((o) => o.setName('channel').setDescription('Alert channel').setRequired(true))
          )
          .addSubcommand((sub) =>
            sub
              .setName('remove')
              .setDescription('Remove a stream alert')
              .addStringOption((o) => o.setName('id').setDescription('Channel ID or username').setRequired(true))
          )
          .addSubcommand((sub) => sub.setName('list').setDescription('List all stream alerts')),
        
        // Game commands
        new SlashCommandBuilder()
          .setName('steamsearch')
          .setDescription('Search for Steam games or players')
          .addSubcommand((sub) =>
            sub
              .setName('game')
              .setDescription('Search for a game on Steam')
              .addStringOption((o) => o.setName('query').setDescription('Game name').setRequired(true))
          )
          .addSubcommand((sub) =>
            sub
              .setName('player')
              .setDescription('Search for a Steam player')
              .addStringOption((o) => o.setName('steamid').setDescription('Steam ID or profile URL').setRequired(true))
          ),
        new SlashCommandBuilder()
          .setName('freegames')
          .setDescription('Check current free games on Epic and Steam'),
        new SlashCommandBuilder()
          .setName('gamesearch')
          .setDescription('Search for game info with ratings and reviews')
          .addStringOption((o) => o.setName('game').setDescription('Game name to search').setRequired(true)),
        new SlashCommandBuilder()
          .setName('steamprofile')
          .setDescription('Get detailed Steam profile information')
          .addStringOption((o) => o.setName('steamid').setDescription('Steam ID or profile URL').setRequired(true)),
        new SlashCommandBuilder()
          .setName('csgo')
          .setDescription('CS:GO player stats and inventory')
          .addSubcommand((sub) =>
            sub
              .setName('stats')
              .setDescription('View CS:GO competitive stats')
              .addStringOption((o) => o.setName('steamid').setDescription('Steam ID or profile URL').setRequired(true))
          )
          .addSubcommand((sub) =>
            sub
              .setName('inventory')
              .setDescription('View CS:GO inventory')
              .addStringOption((o) => o.setName('steamid').setDescription('Steam ID or profile URL').setRequired(true))
          ),
        new SlashCommandBuilder()
          .setName('faceit')
          .setDescription('Search Faceit player profile and stats')
          .addStringOption((o) => o.setName('username').setDescription('Faceit username').setRequired(true)),
      ];

      await rest.put(Routes.applicationCommands(cfg.DISCORD_APP_ID), { body: commands.map(c => c.toJSON()) });
      logger.info({ count: commands.length }, 'Slash commands registered');
    } catch (err) {
      logger.error({ err }, 'Failed to register slash commands');
    }
  });
}
