import { REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;

if (!token || !appId) {
  console.error('❌ Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID in .env');
  process.exit(1);
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log('🗑️  Clearing all global commands...');
    await rest.put(Routes.applicationCommands(appId), { body: [] });
    console.log('✅ All commands cleared!');
    console.log('⏳ Waiting 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  } catch (err) {
    console.error('❌ Error:', err);
  }
})();




