import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const appId = getEnv('DISCORD_APP_ID');
  const token = getEnv('DISCORD_BOT_TOKEN');

  const commands = [
    // Utility Commands
    new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    new SlashCommandBuilder().setName('help').setDescription('Show interactive help menu with all commands'),
    new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Show user avatar')
      .addUserOption((o) => o.setName('user').setDescription('User to show avatar for')),
    new SlashCommandBuilder().setName('server').setDescription('Show server information'),
    new SlashCommandBuilder()
      .setName('user')
      .setDescription('Show user information')
      .addUserOption((o) => o.setName('target').setDescription('User to show info for')),

    // Music Commands
    new SlashCommandBuilder().setName('join').setDescription('Join your voice channel'),
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play music from YouTube, Spotify playlists, or search')
      .addStringOption((o) => o.setName('query').setDescription('Song name, artist, YouTube/Spotify URL').setRequired(true)),
    new SlashCommandBuilder().setName('pause').setDescription('Pause current playback'),
    new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
    new SlashCommandBuilder().setName('skip').setDescription('Skip to next track'),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear queue'),
    new SlashCommandBuilder().setName('queue').setDescription('View the music queue'),
    new SlashCommandBuilder().setName('now').setDescription('Show currently playing track'),
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set player volume')
      .addIntegerOption((o) => o.setName('level').setDescription('Volume level (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Set loop mode')
      .addStringOption((o) => 
        o.setName('mode')
          .setDescription('Loop mode')
          .setRequired(true)
          .addChoices(
            { name: 'Off', value: 'off' },
            { name: 'Track', value: 'track' },
            { name: 'Queue', value: 'queue' }
          )
      ),
    new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
    new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a track from queue')
      .addIntegerOption((o) => o.setName('position').setDescription('Track position in queue').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('leave').setDescription('Leave voice channel'),

    // Moderation Commands
    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for kick')),
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for ban')),
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Member to timeout').setRequired(true))
      .addIntegerOption((o) => o.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for timeout')),
    new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),

    // Anime Commands
    new SlashCommandBuilder()
      .setName('anime')
      .setDescription('View all anime commands and features'),
    new SlashCommandBuilder()
      .setName('animesearch')
      .setDescription('Search for anime on MyAnimeList')
      .addStringOption((o) => o.setName('query').setDescription('Anime name to search').setRequired(true)),
    new SlashCommandBuilder()
      .setName('animeinfo')
      .setDescription('Get detailed anime info with ratings and reviews')
      .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true)),
    new SlashCommandBuilder()
      .setName('animecharacter')
      .setDescription('Search for anime character information')
      .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true)),
    new SlashCommandBuilder()
      .setName('animeupcoming')
      .setDescription('See top 5 upcoming anime episodes'),
    new SlashCommandBuilder()
      .setName('animairing')
      .setDescription('View currently airing anime this season'),
    new SlashCommandBuilder()
      .setName('animealert')
      .setDescription('Manage anime episode alerts')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add an anime to track for new episodes')
          .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true))
          .addChannelOption((o) => o.setName('channel').setDescription('Channel for alerts').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Stop tracking an anime')
          .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true))
      )
      .addSubcommand((sub) => 
        sub.setName('list').setDescription('List all tracked anime')
      ),

    // Economy Commands
    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your coins and level (global)')
      .addUserOption((o) => o.setName('user').setDescription('User to check balance for')),
    new SlashCommandBuilder()
      .setName('daily')
      .setDescription('Claim daily coins (500-800 coins)'),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View global leaderboard')
      .addStringOption((o) => 
        o.setName('type')
          .setDescription('Leaderboard type')
          .addChoices(
            { name: 'Coins', value: 'coins' },
            { name: 'Levels', value: 'levels' }
          )
      ),
    new SlashCommandBuilder()
      .setName('work')
      .setDescription('Work to earn coins (1 hour cooldown)'),
    new SlashCommandBuilder()
      .setName('rob')
      .setDescription('Attempt to rob another user (risky!)')
      .addUserOption((o) => o.setName('user').setDescription('User to rob').setRequired(true)),
    new SlashCommandBuilder()
      .setName('gift')
      .setDescription('Send coins to another user')
      .addUserOption((o) => o.setName('user').setDescription('User to send coins to').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('View your rank card')
      .addUserOption((o) => o.setName('user').setDescription('User to view rank for')),
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('Browse and purchase items')
      .addStringOption((o) =>
        o.setName('action')
          .setDescription('Action to perform')
          .addChoices(
            { name: 'List Items', value: 'list' },
            { name: 'Buy Item', value: 'buy' }
          )
      )
      .addStringOption((o) => o.setName('item').setDescription('Item ID to purchase (when buying)')),
    new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('View your owned items'),

    // Fun & Games Commands
    new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the magic 8-ball a question')
      .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
    new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Play blackjack with your coins (global economy)')
      .addIntegerOption((o) => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(10000)),
    new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Play the slot machine! Match symbols to win big!')
      .addIntegerOption((o) => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(5000)),
    new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin - double or nothing!')
      .addIntegerOption((o) => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(50000))
      .addStringOption((o) => 
        o.setName('choice')
          .setDescription('Heads or Tails?')
          .setRequired(true)
          .addChoices(
            { name: 'Heads', value: 'heads' },
            { name: 'Tails', value: 'tails' }
          )
      ),
    new SlashCommandBuilder()
      .setName('dice')
      .setDescription('Roll dice! Roll 50+ to win with multipliers!')
      .addIntegerOption((o) => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10).setMaxValue(10000)),
    new SlashCommandBuilder()
      .setName('animequote')
      .setDescription('Get a random anime quote'),
    new SlashCommandBuilder()
      .setName('icebreaker')
      .setDescription('Get a random conversation starter'),
    new SlashCommandBuilder()
      .setName('meme')
      .setDescription('Get a random meme from Reddit'),
    new SlashCommandBuilder()
      .setName('hug')
      .setDescription('Hug someone with a cute anime GIF!')
      .addUserOption((o) => o.setName('user').setDescription('User to hug (optional)')),
    new SlashCommandBuilder()
      .setName('kiss')
      .setDescription('Kiss someone with a cute anime GIF!')
      .addUserOption((o) => o.setName('user').setDescription('User to kiss (optional)')),
    new SlashCommandBuilder()
      .setName('cuddle')
      .setDescription('Cuddle someone with a cute anime GIF!')
      .addUserOption((o) => o.setName('user').setDescription('User to cuddle (optional)')),
    new SlashCommandBuilder()
      .setName('slap')
      .setDescription('Slap someone with an anime GIF!')
      .addUserOption((o) => o.setName('user').setDescription('User to slap (optional)')),
    new SlashCommandBuilder()
      .setName('punch')
      .setDescription('Punch someone with an anime GIF!')
      .addUserOption((o) => o.setName('user').setDescription('User to punch (optional)')),
    new SlashCommandBuilder()
      .setName('kickfun')
      .setDescription('Kick someone with an anime GIF (fun, not moderation)!')
      .addUserOption((o) => o.setName('user').setDescription('User to kick (optional)')),

    // Gaming Commands
    new SlashCommandBuilder()
      .setName('steamsearch')
      .setDescription('Search Steam games or players')
      .addSubcommand((sub) =>
        sub
          .setName('game')
          .setDescription('Search for a Steam game')
          .addStringOption((o) => o.setName('query').setDescription('Game name').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('player')
          .setDescription('Search for a Steam player')
          .addStringOption((o) => o.setName('steamid').setDescription('Steam ID or profile URL').setRequired(true))
      ),
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
    new SlashCommandBuilder()
      .setName('freegames')
      .setDescription('Check current free games on Epic and Steam'),
    new SlashCommandBuilder()
      .setName('gamesearch')
      .setDescription('Search for game info with ratings and reviews')
      .addStringOption((o) => o.setName('game').setDescription('Game name').setRequired(true)),

    // Admin Commands
    new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Setup welcome messages for new members')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Configure welcome message')
          .addChannelOption((o) => o.setName('channel').setDescription('Welcome channel').setRequired(true))
          .addStringOption((o) => o.setName('message').setDescription('Welcome message (use {user} for mention)').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('disable').setDescription('Disable welcome messages')
      )
      .addSubcommand((sub) =>
        sub.setName('test').setDescription('Test the welcome message')
      ),
    new SlashCommandBuilder()
      .setName('streamalert')
      .setDescription('Setup YouTube/Twitch stream alerts')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a streamer to track')
          .addStringOption((o) => 
            o.setName('platform')
              .setDescription('Platform')
              .setRequired(true)
              .addChoices(
                { name: 'YouTube', value: 'youtube' },
                { name: 'Twitch', value: 'twitch' }
              )
          )
          .addStringOption((o) => o.setName('channelid').setDescription('Channel/Username ID').setRequired(true))
          .addChannelOption((o) => o.setName('alertchannel').setDescription('Discord channel for alerts').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a streamer from tracking')
          .addStringOption((o) => o.setName('channelid').setDescription('Channel/Username ID').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List all tracked streamers')
      ),
  ];

  const rest = new REST({ version: '10' }).setToken(token);
  
  console.log(`Registering ${commands.length} slash commands...`);
  await rest.put(Routes.applicationCommands(appId), { body: commands.map(c => c.toJSON()) });
  
  console.log('\n✅ Successfully registered all commands:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const categories = {
    'Utility (5)': ['ping', 'help', 'avatar', 'server', 'user'],
    'Music (13)': ['join', 'play', 'pause', 'resume', 'skip', 'stop', 'queue', 'now', 'volume', 'loop', 'shuffle', 'remove', 'leave'],
    'Moderation (4)': ['kick', 'ban', 'mute', 'purge'],
    'Anime (7)': ['anime', 'animesearch', 'animeinfo', 'animecharacter', 'animeupcoming', 'animairing', 'animealert'],
    'Economy (9)': ['balance', 'daily', 'leaderboard', 'work', 'rob', 'gift', 'rank', 'shop', 'inventory'],
    'Fun & Games (14)': ['8ball', 'blackjack', 'slots', 'coinflip', 'dice', 'animequote', 'icebreaker', 'meme', 'hug', 'kiss', 'cuddle', 'slap', 'punch', 'kickfun'],
    'Gaming (6)': ['steamsearch', 'steamprofile', 'csgo', 'faceit', 'freegames', 'gamesearch'],
    'Admin (2)': ['welcome', 'streamalert']
  };
  
  for (const [category, cmds] of Object.entries(categories)) {
    console.log(`\n${category}:`);
    console.log(`  ${cmds.join(', ')}`);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🎉 Total: ${commands.length} commands registered!`);
}

main().catch((err) => {
  console.error('❌ Failed to register commands:', err);
  process.exit(1);
});
