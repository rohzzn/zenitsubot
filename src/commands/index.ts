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
import { remind } from './slash/util/remind.js';
import { qr } from './slash/util/qr.js';
import { screenshot } from './slash/util/screenshot.js';
import { download } from './slash/util/download.js';
import { inspect } from './slash/util/inspect.js';
import { serverlookup } from './slash/util/serverlookup.js';
import { torrent, magnet } from './slash/util/torrent.js';
import { qbit } from './slash/util/qbit.js';

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
import { warn, warnings } from './slash/mod/warn.js';

// Economy
import { balance } from './slash/economy/balance.js';
import { daily } from './slash/economy/daily.js';
import { leaderboard } from './slash/economy/leaderboard.js';
import { work } from './slash/economy/work.js';
import { rob } from './slash/economy/rob.js';
import { gift } from './slash/economy/gift.js';

// Fun
import { blackjack } from './slash/fun/blackjack.js';
import { slots } from './slash/fun/slots.js';
import { coinflip } from './slash/fun/coinflip.js';
import { dice } from './slash/fun/dice.js';
import { meme } from './slash/fun/meme.js';

// Gaming
import { steamsearch } from './slash/games/steamsearch.js';
import { freegames } from './slash/games/freegames.js';

// Developer
import { gh, ghuser } from './slash/dev/github.js';
import { dns, ssl } from './slash/dev/network.js';
import { base64, hash, jwt } from './slash/dev/encode.js';
import { timestamp, regex } from './slash/dev/tools.js';

// AI
import { ask } from './slash/ai/ask.js';
import { aimodel } from './slash/ai/aimodel.js';

// Owner
import { status } from './slash/owner/status.js';
import { logs } from './slash/owner/logs.js';
import { servers } from './slash/owner/servers.js';
import { blacklist } from './slash/owner/blacklist.js';
import { announce } from './slash/owner/announce.js';

export type CommandCategory =
  | 'utility'
  | 'music'
  | 'moderation'
  | 'anime'
  | 'economy'
  | 'fun'
  | 'gaming'
  | 'dev'
  | 'ai'
  | 'admin'
  | 'owner';

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
  /** Hidden from /help. Owner-only operator commands set this. */
  hidden?: boolean;
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
    builder: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Browse every command by category'),
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
  {
    builder: new SlashCommandBuilder()
      .setName('remind')
      .setDescription('Set a reminder for yourself')
      .addSubcommand((sub) =>
        sub
          .setName('set')
          .setDescription('Schedule a reminder')
          .addStringOption((o) =>
            o
              .setName('in')
              .setDescription('How long from now, e.g. 30m, 2h, 1h30m')
              .setRequired(true),
          )
          .addStringOption((o) =>
            o.setName('text').setDescription('What to remind you about').setRequired(true),
          ),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List your pending reminders'))
      .addSubcommand((sub) =>
        sub
          .setName('cancel')
          .setDescription('Cancel a pending reminder')
          .addStringOption((o) =>
            o.setName('id').setDescription('The short id shown by /remind list').setRequired(true),
          ),
      ),
    handler: remind,
    category: 'utility',
    summary: 'Set, list and cancel personal reminders',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('qr')
      .setDescription('Make or read a QR code')
      .addSubcommand((sub) =>
        sub
          .setName('make')
          .setDescription('Turn text or a link into a QR code')
          .addStringOption((o) =>
            o.setName('text').setDescription('What to encode').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('read')
          .setDescription('Decode a QR code from an image')
          .addAttachmentOption((o) =>
            o.setName('image').setDescription('Image containing a QR code').setRequired(true),
          ),
      ),
    handler: qr,
    category: 'utility',
    summary: 'Make or read a QR code',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('screenshot')
      .setDescription('Capture a screenshot of a web page')
      .addStringOption((o) => o.setName('url').setDescription('Page to capture').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('device')
          .setDescription('Viewport size')
          .addChoices({ name: 'Desktop', value: 'desktop' }, { name: 'Mobile', value: 'mobile' }),
      )
      .addBooleanOption((o) =>
        o.setName('full_page').setDescription('Capture the whole page, not just the viewport'),
      ),
    handler: screenshot,
    category: 'utility',
    summary: 'Capture a screenshot of a web page',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('download')
      .setDescription('Download a video from YouTube, X, Instagram, TikTok, Reddit and more')
      .addStringOption((o) =>
        o.setName('url').setDescription('Link to the post or video').setRequired(true),
      )
      .addBooleanOption((o) => o.setName('audio_only').setDescription('Grab just the audio')),
    handler: download,
    category: 'utility',
    summary: 'Download a video or its audio from a link',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('inspect')
      .setDescription('Inspect a site: colours, fonts, images, icons and tech stack')
      .addStringOption((o) => o.setName('url').setDescription('Page to inspect').setRequired(true)),
    handler: inspect,
    category: 'utility',
    summary: 'Inspect a site: colours, fonts, images, icons and tech stack',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('serverlookup')
      .setDescription('Look up a Discord server by ID or invite')
      .addStringOption((o) =>
        o.setName('server').setDescription('Server ID or invite link').setRequired(true),
      ),
    handler: serverlookup,
    category: 'utility',
    summary: 'Look up a Discord server by ID or invite',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('torrent')
      .setDescription('Search the Internet Archive and get a magnet link')
      .addStringOption((o) =>
        o.setName('query').setDescription('What to look for').setRequired(true),
      ),
    handler: torrent,
    category: 'utility',
    summary: 'Search the Internet Archive and get a magnet link',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('magnet')
      .setDescription('Decode a magnet link')
      .addStringOption((o) => o.setName('link').setDescription('The magnet URI').setRequired(true)),
    handler: magnet,
    category: 'utility',
    summary: 'Decode a magnet link into its infohash, size and trackers',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('qbit')
      .setDescription('Control your qBittorrent instance')
      .addSubcommand((sub) => sub.setName('status').setDescription('Speeds and totals'))
      .addSubcommand((sub) =>
        sub
          .setName('list')
          .setDescription('List torrents')
          .addStringOption((o) =>
            o
              .setName('filter')
              .setDescription('Which torrents to show')
              .addChoices(
                { name: 'All', value: 'all' },
                { name: 'Downloading', value: 'downloading' },
                { name: 'Seeding', value: 'seeding' },
                { name: 'Completed', value: 'completed' },
                { name: 'Paused', value: 'paused' },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a magnet link')
          .addStringOption((o) =>
            o.setName('magnet').setDescription('Magnet URI').setRequired(true),
          )
          .addStringOption((o) =>
            o.setName('category').setDescription('Category to file it under'),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('pause')
          .setDescription('Pause a torrent')
          .addStringOption((o) =>
            o.setName('torrent').setDescription('Hash prefix or name').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('resume')
          .setDescription('Resume a torrent')
          .addStringOption((o) =>
            o.setName('torrent').setDescription('Hash prefix or name').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a torrent')
          .addStringOption((o) =>
            o.setName('torrent').setDescription('Hash prefix or name').setRequired(true),
          )
          .addBooleanOption((o) =>
            o.setName('delete_files').setDescription('Also delete the downloaded files'),
          ),
      ),
    handler: qbit,
    category: 'utility',
    summary: 'Control your qBittorrent instance',
    hidden: true,
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
    builder: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop playback and clear the queue'),
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
    builder: new SlashCommandBuilder()
      .setName('now')
      .setDescription('Show the currently playing track'),
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
        o
          .setName('position')
          .setDescription('Position in the queue')
          .setRequired(true)
          .setMinValue(1),
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
      .addUserOption((o) =>
        o.setName('user').setDescription('Member to time out').setRequired(true),
      )
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
  {
    builder: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption((o) =>
        o.setName('reason').setDescription('Why they are being warned').setRequired(true),
      ),
    handler: warn,
    category: 'moderation',
    summary: 'Warn a member and record it',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('View and manage warnings')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addSubcommand((sub) =>
        sub
          .setName('list')
          .setDescription("View a member's warnings")
          .addUserOption((o) =>
            o.setName('user').setDescription('Member to check').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a single warning')
          .addStringOption((o) =>
            o
              .setName('id')
              .setDescription('The short id shown by /warnings list')
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('clear')
          .setDescription('Clear every warning for a member')
          .addUserOption((o) =>
            o.setName('user').setDescription('Member to clear').setRequired(true),
          ),
      ),
    handler: warnings,
    category: 'moderation',
    summary: "View, remove and clear members' warnings",
  },

  // ------------------------------------------------------------------ Anime

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

  // -------------------------------------------------------------------- Fun
  {
    builder: new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Play blackjack with your coins')
      .addIntegerOption((o) =>
        o
          .setName('bet')
          .setDescription('Amount to bet')
          .setRequired(true)
          .setMinValue(10)
          .setMaxValue(10000),
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
        o
          .setName('bet')
          .setDescription('Amount to bet')
          .setRequired(true)
          .setMinValue(10)
          .setMaxValue(5000),
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
        o
          .setName('bet')
          .setDescription('Amount to bet')
          .setRequired(true)
          .setMinValue(10)
          .setMaxValue(50000),
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
        o
          .setName('bet')
          .setDescription('Amount to bet')
          .setRequired(true)
          .setMinValue(10)
          .setMaxValue(10000),
      ),
    handler: dice,
    category: 'fun',
    summary: 'Roll dice for a multiplier payout',
  },
  {
    builder: new SlashCommandBuilder().setName('meme').setDescription('Get a random meme'),
    handler: meme,
    category: 'fun',
    summary: 'Get a random meme',
  },

  // ----------------------------------------------------------------- Gaming
  {
    builder: new SlashCommandBuilder()
      .setName('steamsearch')
      .setDescription('Search the Steam store')
      .addStringOption((o) => o.setName('query').setDescription('Game name').setRequired(true)),
    handler: steamsearch,
    category: 'gaming',
    summary: 'Search the Steam store',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('freegames')
      .setDescription('Current free game giveaways on Epic'),
    handler: freegames,
    category: 'gaming',
    summary: 'Current free game giveaways on Epic',
  },

  // -------------------------------------------------------------- Developer
  {
    builder: new SlashCommandBuilder()
      .setName('gh')
      .setDescription('Look up a GitHub repository')
      .addStringOption((o) =>
        o.setName('repo').setDescription('owner/repo, e.g. rohzzn/zenitsubot').setRequired(true),
      ),
    handler: gh,
    category: 'dev',
    summary: 'Look up a GitHub repository',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('ghuser')
      .setDescription('Look up a GitHub user')
      .addStringOption((o) =>
        o.setName('username').setDescription('GitHub username').setRequired(true),
      ),
    handler: ghuser,
    category: 'dev',
    summary: 'Look up a GitHub user',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('dns')
      .setDescription('Look up DNS records for a domain')
      .addStringOption((o) => o.setName('domain').setDescription('Domain name').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Limit to one record type')
          .addChoices(
            { name: 'A', value: 'A' },
            { name: 'AAAA', value: 'AAAA' },
            { name: 'CNAME', value: 'CNAME' },
            { name: 'MX', value: 'MX' },
            { name: 'TXT', value: 'TXT' },
            { name: 'NS', value: 'NS' },
          ),
      ),
    handler: dns,
    category: 'dev',
    summary: 'Look up DNS records for a domain',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('ssl')
      .setDescription("Inspect a domain's TLS certificate")
      .addStringOption((o) => o.setName('domain').setDescription('Domain name').setRequired(true)),
    handler: ssl,
    category: 'dev',
    summary: "Inspect a domain's TLS certificate and expiry",
  },
  {
    builder: new SlashCommandBuilder()
      .setName('base64')
      .setDescription('Encode or decode base64')
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Direction')
          .setRequired(true)
          .addChoices({ name: 'Encode', value: 'encode' }, { name: 'Decode', value: 'decode' }),
      )
      .addStringOption((o) =>
        o.setName('text').setDescription('Text to convert').setRequired(true),
      ),
    handler: base64,
    category: 'dev',
    summary: 'Encode or decode base64',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('hash')
      .setDescription('Hash text with a chosen algorithm')
      .addStringOption((o) =>
        o
          .setName('algorithm')
          .setDescription('Hash algorithm')
          .setRequired(true)
          .addChoices(
            { name: 'MD5', value: 'md5' },
            { name: 'SHA-1', value: 'sha1' },
            { name: 'SHA-256', value: 'sha256' },
            { name: 'SHA-512', value: 'sha512' },
          ),
      )
      .addStringOption((o) => o.setName('text').setDescription('Text to hash').setRequired(true)),
    handler: hash,
    category: 'dev',
    summary: 'Hash text with MD5, SHA-1, SHA-256 or SHA-512',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('jwt')
      .setDescription('Decode a JWT (signature is not verified)')
      .addStringOption((o) =>
        o.setName('token').setDescription('The token to decode').setRequired(true),
      ),
    handler: jwt,
    category: 'dev',
    summary: 'Decode a JWT header and payload',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('timestamp')
      .setDescription('Generate Discord timestamp codes')
      .addStringOption((o) =>
        o.setName('when').setDescription('now, +30m, a Unix timestamp, or a date'),
      ),
    handler: timestamp,
    category: 'dev',
    summary: 'Generate Discord timestamp codes',
  },
  {
    builder: new SlashCommandBuilder()
      .setName('regex')
      .setDescription('Test a regular expression against sample text')
      .addStringOption((o) => o.setName('pattern').setDescription('The pattern').setRequired(true))
      .addStringOption((o) =>
        o.setName('text').setDescription('Text to match against').setRequired(true),
      )
      .addStringOption((o) => o.setName('flags').setDescription('Regex flags, default g')),
    handler: regex,
    category: 'dev',
    summary: 'Test a regular expression and show captures',
  },

  // --------------------------------------------------------------------- AI
  {
    builder: new SlashCommandBuilder()
      .setName('aimodel')
      .setDescription('View or change the AI model')
      .addSubcommand((sub) => sub.setName('current').setDescription('Show the model in use'))
      .addSubcommand((sub) => sub.setName('list').setDescription('List every free model'))
      .addSubcommand((sub) =>
        sub
          .setName('set')
          .setDescription('Switch to another model (owner only)')
          .addStringOption((o) =>
            o
              .setName('model')
              .setDescription('Start typing to search free models')
              .setRequired(true)
              .setAutocomplete(true),
          ),
      ),
    handler: aimodel,
    category: 'ai',
    summary: 'View or change the AI model',
  },

  // ------------------------------------------------------------------ Owner
  {
    builder: new SlashCommandBuilder()
      .setName('status')
      .setDescription('Bot health, memory, Lavalink and database status'),
    handler: status,
    category: 'owner',
    summary: 'Bot health, memory, Lavalink and database status',
    hidden: true,
  },
  {
    builder: new SlashCommandBuilder()
      .setName('logs')
      .setDescription('Show recent warnings and errors')
      .addIntegerOption((o) =>
        o.setName('count').setDescription('How many entries (1-25)').setMinValue(1).setMaxValue(25),
      ),
    handler: logs,
    category: 'owner',
    summary: 'Show recent warnings and errors',
    hidden: true,
  },
  {
    builder: new SlashCommandBuilder()
      .setName('servers')
      .setDescription('List servers the bot is in'),
    handler: servers,
    category: 'owner',
    summary: 'List servers the bot is in',
    hidden: true,
  },
  {
    builder: new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Block users or servers from using the bot')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Block a user or server')
          .addStringOption((o) =>
            o.setName('id').setDescription('User or guild id').setRequired(true),
          )
          .addStringOption((o) =>
            o
              .setName('type')
              .setDescription('What the id refers to')
              .setRequired(true)
              .addChoices({ name: 'User', value: 'user' }, { name: 'Guild', value: 'guild' }),
          )
          .addStringOption((o) => o.setName('reason').setDescription('Why they are blocked')),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Unblock a user or server')
          .addStringOption((o) =>
            o.setName('id').setDescription('User or guild id').setRequired(true),
          ),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List blocked users and servers')),
    handler: blacklist,
    category: 'owner',
    summary: 'Block users or servers from using the bot',
    hidden: true,
  },
  {
    builder: new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Post an announcement to every server')
      .addStringOption((o) =>
        o.setName('title').setDescription('Announcement title').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('message').setDescription('Announcement body').setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName('dry_run').setDescription('Preview without sending, defaults to true'),
      ),
    handler: announce,
    category: 'owner',
    summary: 'Post an announcement to every server',
    hidden: true,
  },
];

export const CATEGORY_LABELS: Record<CommandCategory, { label: string; blurb: string }> = {
  music: { label: 'Music', blurb: 'Play and control audio in voice channels' },
  fun: { label: 'Fun', blurb: 'Games, gambling and reaction GIFs' },
  economy: { label: 'Economy', blurb: 'Coins, levels and the shop' },
  anime: { label: 'Anime', blurb: 'Search MyAnimeList and track new episodes' },
  dev: { label: 'Developer', blurb: 'Package lookups, encoding and network tools' },
  ai: { label: 'AI & Search', blurb: 'Ask questions answered from live web results' },
  utility: { label: 'Utility', blurb: 'Everyday helpers and reminders' },
  moderation: { label: 'Moderation', blurb: 'Warnings, timeouts, bans and purges' },
  gaming: { label: 'Gaming', blurb: 'Steam and free game giveaways' },
  admin: { label: 'Admin', blurb: 'Server configuration' },
  owner: { label: 'Owner', blurb: 'Bot operator tools' },
};

/** Display order in /help. Owner is excluded because its commands are hidden. */
export const CATEGORY_ORDER: CommandCategory[] = [
  'ai',
  'music',
  'fun',
  'economy',
  'anime',
  'dev',
  'utility',
  'moderation',
  'gaming',
  'admin',
];

export function commandsByCategory(category: CommandCategory): CommandDefinition[] {
  return COMMANDS.filter((c) => c.category === category);
}

/** Commands shown in /help — everything except owner-only operator tools. */
export function visibleCommands(category: CommandCategory): CommandDefinition[] {
  return commandsByCategory(category).filter((c) => !c.hidden);
}

/**
 * Categories that actually have something to show. Removing commands used to
 * leave empty categories listed in /help with a count of zero.
 */
export const POPULATED_CATEGORIES: CommandCategory[] = CATEGORY_ORDER.filter(
  (category) => visibleCommands(category).length > 0,
);

export const VISIBLE_COMMAND_COUNT = COMMANDS.filter((c) => !c.hidden).length;
