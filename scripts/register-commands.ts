import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { COMMANDS, CATEGORY_LABELS, CATEGORY_ORDER, commandsByCategory } from '../src/commands/index.js';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const appId = getEnv('DISCORD_APP_ID');
  const token = getEnv('DISCORD_BOT_TOKEN');

  const names = COMMANDS.map((c) => c.handler.data.name);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  if (duplicates.length) {
    throw new Error(`Duplicate command names: ${[...new Set(duplicates)].join(', ')}`);
  }

  // The builder name and the handler it dispatches to must agree, or Discord
  // would show a command that resolves to nothing at runtime.
  for (const { builder, handler } of COMMANDS) {
    const builderName = builder.toJSON().name;
    if (builderName !== handler.data.name) {
      throw new Error(`Command definition mismatch: builder "${builderName}" vs handler "${handler.data.name}"`);
    }
  }

  const rest = new REST({ version: '10' }).setToken(token);

  console.log(`Registering ${COMMANDS.length} slash commands...`);
  await rest.put(Routes.applicationCommands(appId), {
    body: COMMANDS.map((c) => c.builder.toJSON()),
  });

  console.log('\nRegistered:');
  for (const category of CATEGORY_ORDER) {
    const commands = commandsByCategory(category);
    if (!commands.length) continue;
    const { label, emoji } = CATEGORY_LABELS[category];
    console.log(`\n  ${emoji} ${label} (${commands.length})`);
    console.log(`    ${commands.map((c) => c.handler.data.name).join(', ')}`);
  }

  console.log(`\nTotal: ${COMMANDS.length} commands.`);
}

main().catch((err) => {
  console.error('Failed to register commands:', err);
  process.exit(1);
});
