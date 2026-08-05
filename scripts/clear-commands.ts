import 'dotenv/config';
import { REST, Routes } from 'discord.js';

// The rest of the project uses DISCORD_APP_ID; accept the longer spelling too
// so an older .env keeps working.
const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID ?? process.env.DISCORD_APPLICATION_ID;

if (!token || !appId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APP_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

try {
  console.log('Clearing all global commands...');
  await rest.put(Routes.applicationCommands(appId), { body: [] });
  console.log('All commands cleared. Run `npm run register:commands` to restore them.');
} catch (err) {
  console.error('Failed to clear commands:', err);
  process.exit(1);
}
