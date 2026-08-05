import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import type {
  Client,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

// Utility
import { ping } from './slash/ping.js';
import { help } from './slash/help.js';
import { avatar } from './slash/util/avatar.js';
import { server } from './slash/util/server.js';
import { user } from './slash/util/user.js';

// Music
import { join } from './slash/music/join.js';
import { play } from './slash/music/play.js';
import { pause } from './slash/music/pause.js';
import { resume } from './slash/music/resume.js';
import { skip } from './slash/music/skip.js';
import { stop } from './slash/music/stop.js';
import { queue } from './slash/music/queue.js';
import { now } from './slash/music/now.js';
import { volume } from './slash/music/volume.js';
import { loop } from './slash/music/loop.js';
import { shuffle } from './slash/music/shuffle.js';
import { remove } from './slash/music/remove.js';
import { leave } from './slash/music/leave.js';

// Moderation
import { kick } from './slash/mod/kick.js';
import { ban } from './slash/mod/ban.js';
import { mute } from './slash/mod/mute.js';
import { purge } from './slash/mod/purge.js';

// Anime
import { animesearch } from './slash/anime/search.js';
import { animeinfo } from './slash/anime/info.js';
import { animecharacter } from './slash/anime/character.js';
import { animeupcoming } from './slash/anime/upcoming.js';
import { animairing } from './slash/anime/airing.js';
import { animealert } from './slash/anime/alert.js';

// Economy
import { balance } from './slash/economy/balance.js';
import { daily } from './slash/economy/daily.js';
import { leaderboard } from './slash/economy/leaderboard.js';
import { work } from './slash/economy/work.js';
import { rob } from './slash/economy/rob.js';
import { gift } from './slash/economy/gift.js';
import { rank } from './slash/economy/rank.js';
import { shop } from './slash/economy/shop.js';
import { inventory } from './slash/economy/inventory.js';

// Fun
import { eightball } from './slash/fun/8ball.js';
import { blackjack } from './slash/fun/blackjack.js';
import { slots } from './slash/fun/slots.js';
import { coinflip } from './slash/fun/coinflip.js';
import { dice } from './slash/fun/dice.js';
import { animequote } from './slash/fun/animequote.js';
import { icebreaker } from './slash/fun/icebreaker.js';
import { meme } from './slash/fun/meme.js';
import { reactionCommands } from './slash/fun/reactions.js';

// Gaming
import { steamsearch } from './slash/games/steamsearch.js';
import { freegames } from './slash/games/freegames.js';

// Admin
import { welcome } from './slash/admin/welcome.js';

export type CommandCategory =
  | 'utility'
  | 'music'
  | 'moderation'
  | 'anime'
  | 'economy'
  | 'fun'
  | 'gaming'
  | 'admin';

export interface CommandHandler {
  data: { name: string };
  execute: (client: Client, interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * The single source of truth for every slash command.
 *
 * Pairing the Discord-facing definition with the handler that reads its options
 * in one place is deliberate: when these lived in separate files their option
 * names drifted apart, which silently broke commands at runtime.
 */
export interface CommandDefinition {
  /**
   * Any SlashCommandBuilder variant. The builder's concrete type narrows as
   * options and subcommands are added, so we only depend on serialisation.
   */
  builder: { toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  handler: CommandHandler;
  category: CommandCategory;
  /** One-line summary used by /help. */
  summary: string;
}

function reactionDefinitions(): CommandDefinition[] {
  const summaries: Record<string, string> = {
    hug: 'Hug someone with an anime GIF',
    kiss: 'Kiss someone with an anime GIF',
    cuddle: 'Cuddle someone with an anime GIF',
    pat: 'Pat someone with an anime GIF',
    slap: 'Slap someone with an anime GIF',
    punch: 'Punch someone with an anime GIF',
  };

  return reactionCommands.map((handler) => {
    const name = handler.data.name;
    const summary = summaries[name] ?? `React with a ${name} GIF`;

    return {
      builder: new SlashCommandBuilder()
        .setName(name)
        .setDescription(summary)
        .addUserOption((o) => o.setName('user').setDescription(`User to ${name} (optional)`)),
      handler,
      category: 'fun' as const,
      summary,
    };
  });
}

export const COMMANDS: CommandDefinition[] = [
  // ---------------------------------------------------------------- Utility
  {
    builder: new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    handler: ping,
    category: 'utility',
    summary: 'Check bot latency',
  },
  {
    builder: new SlashCommandBuilder().setName('help').setDescription('Browse every command by category'),
    handler: help,
    category: 'utility',
    summary: 'Browse every command by category',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription("Show a user's avatar")
      .addUserOption((o) => o.setName('user').setDescription('User to show the avatar for')),
    handler: avatar,
    category: 'utility',
    summary: "Show a user's avatar",
  },
  {
    builder: new SlashCommandBuilder().setName('server').setDescription('Show server information'),
    handler: server,
    category: 'utility',
    summary: 'Show server information',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('user')
      .setDescription('Show information about a member')
      .addUserOption((o) => o.setName('target').setDescription('Member to show info for')),
    handler: user,
    category: 'utility',
    summary: 'Show information about a member',
  },

  // ------------------------------------------------------------------ Music
  {
    builder: new SlashCommandBuilder().setName('join').setDescription('Join your voice channel'),
    handler: join,
    category: 'music',
    summary: 'Join your voice channel',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a track from a search, YouTube link or Spotify playlist')
      .addStringOption((o) =>
        o.setName('query').setDescription('Song name, artist, or URL').setRequired(true),
      ),
    handler: play,
    category: 'music',
    summary: 'Play a track from a search or URL',
  },
  {
    builder: new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
    handler: pause,
    category: 'music',
    summary: 'Pause playback',
  },
  {
    builder: new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
    handler: resume,
    category: 'music',
    summary: 'Resume playback',
  },
  {
    builder: new SlashCommandBuilder().setName('skip').setDescription('Skip to the next track'),
    handler: skip,
    category: 'music',
    summary: 'Skip to the next track',
  },
  {
    builder: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),
    handler: stop,
    category: 'music',
    summary: 'Stop playback and clear the queue',
  },
  {
    builder: new SlashCommandBuilder().setName('queue').setDescription('View the music queue'),
    handler: queue,
    category: 'music',
    summary: 'View the music queue',
  },
  {
    builder: new SlashCommandBuilder().setName('now').setDescription('Show the currently playing track'),
    handler: now,
    category: 'music',
    summary: 'Show the currently playing track',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set the player volume')
      .addIntegerOption((o) =>
        o
          .setName('level')
          .setDescription('Volume level (1-100)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),
    handler: volume,
    category: 'music',
    summary: 'Set the player volume',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Set the loop mode')
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Loop mode')
          .setRequired(true)
          .addChoices(
            { name: 'Off', value: 'off' },
            { name: 'Track', value: 'track' },
            { name: 'Queue', value: 'queue' },
          ),
      ),
    handler: loop,
    category: 'music',
    summary: 'Set the loop mode',
  },
  {
    builder: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
    handler: shuffle,
    category: 'music',
    summary: 'Shuffle the queue',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a track from the queue')
      .addIntegerOption((o) =>
        o.setName('position').setDescription('Position in the queue').setRequired(true).setMinValue(1),
      ),
    handler: remove,
    category: 'music',
    summary: 'Remove a track from the queue',
  },
  {
    builder: new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
    handler: leave,
    category: 'music',
    summary: 'Leave the voice channel',
  },

  // ------------------------------------------------------------- Moderation
  {
    builder: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the kick')),
    handler: kick,
    category: 'moderation',
    summary: 'Kick a member from the server',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban')),
    handler: ban,
    category: 'moderation',
    summary: 'Ban a member from the server',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Time out a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Member to time out').setRequired(true))
      .addIntegerOption((o) =>
        o
          .setName('duration')
          .setDescription('Duration in minutes')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(40320),
      )
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the timeout')),
    handler: mute,
    category: 'moderation',
    summary: 'Time out a member for a number of minutes',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete recent messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) =>
        o
          .setName('amount')
          .setDescription('Number of messages to delete (1-100)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),
    handler: purge,
    category: 'moderation',
    summary: 'Bulk delete recent messages',
  },

  // ------------------------------------------------------------------ Anime
  {
    builder: new SlashCommandBuilder()
      .setName('animesearch')
      .setDescription('Search for anime on MyAnimeList')
      .addStringOption((o) => o.setName('query').setDescription('Anime name').setRequired(true)),
    handler: animesearch,
    category: 'anime',
    summary: 'Search for anime on MyAnimeList',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('animeinfo')
      .setDescription('Get detailed anime info with ratings and reviews')
      .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true)),
    handler: animeinfo,
    category: 'anime',
    summary: 'Detailed anime info with ratings and reviews',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('animecharacter')
      .setDescription('Look up an anime character')
      .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true)),
    handler: animecharacter,
    category: 'anime',
    summary: 'Look up an anime character',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('animeupcoming')
      .setDescription('See upcoming anime episodes'),
    handler: animeupcoming,
    category: 'anime',
    summary: 'See upcoming anime episodes',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('animairing')
      .setDescription('View anime airing this season'),
    handler: animairing,
    category: 'anime',
    summary: 'View anime airing this season',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('animealert')
      .setDescription('Manage new-episode alerts')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Track an anime for new episodes')
          .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true))
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Channel for alerts').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Stop tracking an anime')
          .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true)),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List all tracked anime')),
    handler: animealert,
    category: 'anime',
    summary: 'Manage new-episode alerts',
  },

  // ---------------------------------------------------------------- Economy
  {
    builder: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check coins and level')
      .addUserOption((o) => o.setName('user').setDescription('User to check')),
    handler: balance,
    category: 'economy',
    summary: 'Check coins and level',
  },
  {
    builder: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
    handler: daily,
    category: 'economy',
    summary: 'Claim your daily coins',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the global leaderboard')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Leaderboard type')
          .addChoices({ name: 'Coins', value: 'coins' }, { name: 'Levels', value: 'levels' }),
      ),
    handler: leaderboard,
    category: 'economy',
    summary: 'View the global leaderboard',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('work')
      .setDescription('Work to earn coins (1 hour cooldown)'),
    handler: work,
    category: 'economy',
    summary: 'Work to earn coins (1 hour cooldown)',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('rob')
      .setDescription('Attempt to rob another user (risky!)')
      .addUserOption((o) => o.setName('user').setDescription('User to rob').setRequired(true)),
    handler: rob,
    category: 'economy',
    summary: 'Attempt to rob another user (risky!)',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('gift')
      .setDescription('Send coins to another user')
      .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1),
      ),
    handler: gift,
    category: 'economy',
    summary: 'Send coins to another user',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('rank')
      .setDescription('View a rank card')
      .addUserOption((o) => o.setName('user').setDescription('User to view')),
    handler: rank,
    category: 'economy',
    summary: 'View a rank card',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('shop')
      .setDescription('Browse and purchase items')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('What to do')
          .addChoices({ name: 'List Items', value: 'list' }, { name: 'Buy Item', value: 'buy' }),
      )
      .addStringOption((o) => o.setName('item').setDescription('Item ID to purchase')),
    handler: shop,
    category: 'economy',
    summary: 'Browse and purchase items',
  },
  {
    builder: new SlashCommandBuilder().setName('inventory').setDescription('View your owned items'),
    handler: inventory,
    category: 'economy',
    summary: 'View your owned items',
  },

  // -------------------------------------------------------------------- Fun
  {
    builder: new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the magic 8-ball a question')
      .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
    handler: eightball,
    category: 'fun',
    summary: 'Ask the magic 8-ball a question',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Play blackjack with your coins')
      .addIntegerOption((o) =>
        o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(10000),
      ),
    handler: blackjack,
    category: 'fun',
    summary: 'Play blackjack with your coins',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Spin the slot machine')
      .addIntegerOption((o) =>
        o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(5000),
      ),
    handler: slots,
    category: 'fun',
    summary: 'Spin the slot machine',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin — double or nothing')
      .addIntegerOption((o) =>
        o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(50000),
      )
      .addStringOption((o) =>
        o
          .setName('choice')
          .setDescription('Heads or tails?')
          .setRequired(true)
          .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }),
      ),
    handler: coinflip,
    category: 'fun',
    summary: 'Flip a coin — double or nothing',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('dice')
      .setDescription('Roll dice for a multiplier payout')
      .addIntegerOption((o) =>
        o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(10000),
      ),
    handler: dice,
    category: 'fun',
    summary: 'Roll dice for a multiplier payout',
  },
  {
    builder: new SlashCommandBuilder().setName('animequote').setDescription('Get a random anime quote'),
    handler: animequote,
    category: 'fun',
    summary: 'Get a random anime quote',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('icebreaker')
      .setDescription('Get a random conversation starter'),
    handler: icebreaker,
    category: 'fun',
    summary: 'Get a random conversation starter',
  },
  {
    builder: new SlashCommandBuilder().setName('meme').setDescription('Get a random meme'),
    handler: meme,
    category: 'fun',
    summary: 'Get a random meme',
  },
  ...reactionDefinitions(),

  // ----------------------------------------------------------------- Gaming
  {
    builder: new SlashCommandBuilder()
      .setName('steamsearch')
      .setDescription('Search the Steam store')
      .addSubcommand((sub) =>
        sub
          .setName('game')
          .setDescription('Search for a Steam game')
          .addStringOption((o) => o.setName('query').setDescription('Game name').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('player')
          .setDescription('Look up a Steam player')
          .addStringOption((o) =>
            o.setName('steamid').setDescription('Steam ID or profile URL').setRequired(true),
          ),
      ),
    handler: steamsearch,
    category: 'gaming',
    summary: 'Search Steam games and players',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('freegames')
      .setDescription('Current free game giveaways on Epic'),
    handler: freegames,
    category: 'gaming',
    summary: 'Current free game giveaways on Epic',
  },

  // ------------------------------------------------------------------ Admin
  {
    builder: new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Configure welcome messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Configure the welcome message')
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Welcome channel').setRequired(true),
          )
          .addStringOption((o) =>
            o
              .setName('message')
              .setDescription('Message text — {user}, {server} and {memberCount} are substituted')
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable welcome messages'))
      .addSubcommand((sub) => sub.setName('test').setDescription('Send a test welcome message')),
    handler: welcome,
    category: 'admin',
    summary: 'Configure welcome messages',
  },
];

export const CATEGORY_LABELS: Record<CommandCategory, { label: string; emoji: string }> = {
  utility: { label: 'Utility', emoji: '🔧' },
  music: { label: 'Music', emoji: '🎵' },
  moderation: { label: 'Moderation', emoji: '🛡️' },
  anime: { label: 'Anime', emoji: '📺' },
  economy: { label: 'Economy', emoji: '💰' },
  fun: { label: 'Fun & Games', emoji: '🎲' },
  gaming: { label: 'Gaming', emoji: '🎮' },
  admin: { label: 'Admin', emoji: '⚙️' },
};

export const CATEGORY_ORDER: CommandCategory[] = [
  'music',
  'fun',
  'economy',
  'anime',
  'utility',
  'moderation',
  'gaming',
  'admin',
];

export function commandsByCategory(category: CommandCategory): CommandDefinition[] {
  return COMMANDS.filter((c) => c.category === category);
}
