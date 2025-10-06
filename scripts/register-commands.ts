import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const appId = getEnv('DISCORD_APP_ID');
  const token = getEnv('DISCORD_BOT_TOKEN');

  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Show latency').toJSON(),
    new SlashCommandBuilder().setName('help').setDescription('Show help').toJSON(),
    new SlashCommandBuilder().setName('join').setDescription('Join your voice channel').toJSON(),
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song from query or URL')
      .addStringOption((o) => o.setName('query').setDescription('Song name, artist, or URL').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder().setName('pause').setDescription('Pause the player').toJSON(),
    new SlashCommandBuilder().setName('resume').setDescription('Resume the player').toJSON(),
    new SlashCommandBuilder().setName('skip').setDescription('Skip current track').toJSON(),
    new SlashCommandBuilder().setName('stop').setDescription('Stop and leave voice channel').toJSON(),
    new SlashCommandBuilder().setName('queue').setDescription('Show the music queue').toJSON(),
    new SlashCommandBuilder().setName('now').setDescription('Show currently playing track').toJSON(),
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set player volume')
      .addIntegerOption((o) => o.setName('level').setDescription('Volume (0-100)').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder().setName('loop').setDescription('Toggle loop mode').toJSON(),
    new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue').toJSON(),
    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member')
      .addUserOption((o) => o.setName('user').setDescription('User to kick').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member')
      .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout a member')
      .addUserOption((o) => o.setName('user').setDescription('User to mute').setRequired(true))
      .addIntegerOption((o) => o.setName('duration').setDescription('Duration in minutes').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete messages')
      .addIntegerOption((o) => o.setName('amount').setDescription('Number of messages (1-100)').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Show user avatar')
      .addUserOption((o) => o.setName('user').setDescription('User'))
      .toJSON(),
    new SlashCommandBuilder().setName('server').setDescription('Show server info').toJSON(),
    new SlashCommandBuilder()
      .setName('user')
      .setDescription('Show user info')
      .addUserOption((o) => o.setName('target').setDescription('User'))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('anime')
      .setDescription('Anime commands - see all available anime features')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('animesearch')
      .setDescription('Search for anime on MyAnimeList')
      .addStringOption((o) => o.setName('query').setDescription('Anime name to search').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('animeinfo')
      .setDescription('Get detailed anime info with reviews and ratings')
      .addStringOption((o) => o.setName('name').setDescription('Anime name').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('animeupcoming')
      .setDescription('See top 5 upcoming anime episodes airing soon')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('animecharacter')
      .setDescription('Search for anime characters')
      .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('animealert')
      .setDescription('Setup anime episode alerts')
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
      .addSubcommand((sub) => sub.setName('list').setDescription('List tracked anime'))
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(appId), { body: commands });
  console.log('Registered global commands:', commands.map((c) => c.name).join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


