import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import {
  COMMANDS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  commandsByCategory,
} from '../src/commands/index.js';

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
      throw new Error(
        `Command definition mismatch: builder "${builderName}" vs handler "${handler.data.name}"`,
      );
    }
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const body = COMMANDS.map((c) => c.builder.toJSON());

  // Guild-scoped only, and the global list is deliberately emptied.
  //
  // Discord does NOT deduplicate: a command registered both globally and per
  // guild shows up twice in the picker. Guild commands appear instantly where
  // global ones take up to an hour, so guild wins and global is cleared.
  // The bot registers commands for any new guild it joins, in guildCreate.
  const guilds = (await rest.get(Routes.userGuilds())) as Array<{ id: string; name: string }>;

  console.log(`Registering ${COMMANDS.length} commands in ${guilds.length} guild(s)...`);

  for (const guild of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body });
      console.log(`  ${guild.name}`);
    } catch (err) {
      console.error(`  could not register in ${guild.name}:`, (err as Error).message);
    }
  }

  const existingGlobal = (await rest.get(Routes.applicationCommands(appId))) as unknown[];
  if (existingGlobal.length > 0) {
    console.log(`Clearing ${existingGlobal.length} global commands to stop duplicates...`);
    await rest.put(Routes.applicationCommands(appId), { body: [] });
  }

  console.log('\nRegistered:');
  // CATEGORY_ORDER drives /help and omits owner commands, so append them here.
  const categories = [...CATEGORY_ORDER, 'owner' as const];

  for (const category of categories) {
    const commands = commandsByCategory(category);
    if (!commands.length) continue;

    const { label } = CATEGORY_LABELS[category];
    const note = commands.every((c) => c.hidden) ? ' [hidden from /help]' : '';
    console.log(`\n  ${label} (${commands.length})${note}`);
    console.log(`    ${commands.map((c) => c.handler.data.name).join(', ')}`);
  }

  console.log(`\nTotal: ${COMMANDS.length} commands.`);
}

main().catch((err) => {
  console.error('Failed to register commands:', err);
  process.exit(1);
});
