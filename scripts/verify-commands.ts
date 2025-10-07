import 'dotenv/config';
import { REST, Routes } from 'discord.js';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const appId = getEnv('DISCORD_APP_ID');
  const token = getEnv('DISCORD_BOT_TOKEN');

  const rest = new REST().setToken(token);

  console.log('📡 Fetching commands from Discord API...\n');
  
  const commands = await rest.get(Routes.applicationCommands(appId)) as any[];
  
  console.log(`✅ Total commands on Discord: ${commands.length}\n`);
  
  // Check for new commands
  const newCommands = ['hug', 'kiss', 'cuddle', 'slap', 'punch', 'kickfun', 'work', 'rob', 'gift', 'rank', 'shop', 'inventory', 'meme', 'slots', 'coinflip', 'dice'];
  
  console.log('🔍 Checking for new commands:');
  for (const cmdName of newCommands) {
    const found = commands.find((c: any) => c.name === cmdName);
    if (found) {
      console.log(`  ✅ /${cmdName} - FOUND`);
    } else {
      console.log(`  ❌ /${cmdName} - MISSING`);
    }
  }
  
  console.log('\n📋 All command names on Discord:');
  commands.forEach((c: any) => console.log(`  - ${c.name}`));
}

main().catch(console.error);


