import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { COMMANDS } from '../src/commands/index.js';
import { CONTEXT_MENUS } from '../src/commands/context.js';

/**
 * Cross-checks three things that must stay in agreement:
 *   1. every builder resolves to a handler of the same name
 *   2. no duplicate or handler-less commands
 *   3. what Discord currently has registered matches the local definitions
 *
 * Run with DISCORD_APP_ID/DISCORD_BOT_TOKEN set to include step 3.
 */

interface OptionJson {
  name: string;
  type: number;
  required?: boolean;
  options?: OptionJson[];
}

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

function declaredOptionNames(options: OptionJson[] = []): Set<string> {
  const names = new Set<string>();
  for (const option of options) {
    if (option.type === SUBCOMMAND || option.type === SUBCOMMAND_GROUP) {
      for (const nested of declaredOptionNames(option.options)) names.add(nested);
    } else {
      names.add(option.name);
    }
  }
  return names;
}

function checkLocalDefinitions(): number {
  let failures = 0;
  const fail = (message: string) => {
    console.error(`  FAIL  ${message}`);
    failures++;
  };

  console.log('Checking builder/handler agreement...');
  const seen = new Set<string>();

  for (const { builder, handler } of COMMANDS) {
    const json = builder.toJSON();

    if (json.name !== handler.data.name) {
      fail(`builder "${json.name}" is wired to handler "${handler.data.name}"`);
    }
    if (seen.has(json.name)) {
      fail(`duplicate command name "${json.name}"`);
    }
    seen.add(json.name);

    if (typeof handler.execute !== 'function') {
      fail(`"${json.name}" has no execute function`);
    }
  }

  console.log(`  ${COMMANDS.length} commands checked.`);
  return failures;
}

async function compareWithDiscord(): Promise<number> {
  const appId = process.env.DISCORD_APP_ID;
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!appId || !token) {
    console.log('\nSkipping live comparison (DISCORD_APP_ID / DISCORD_BOT_TOKEN not set).');
    return 0;
  }

  console.log('\nComparing against Discord...');
  const rest = new REST({ version: '10' }).setToken(token);

  // Registration is guild-scoped, so the global list must stay empty:
  // anything left there shows up as a duplicate alongside the guild copy.
  const globals = (await rest.get(Routes.applicationCommands(appId))) as unknown[];
  if (globals.length > 0) {
    console.error(
      `  DUPLICATE  ${globals.length} global commands still registered; each appears twice.`,
    );
    console.error('             Run register:commands to clear them.');
  }

  const guilds = (await rest.get(Routes.userGuilds())) as Array<{ id: string; name: string }>;
  if (guilds.length === 0) {
    console.log('  Bot is not in any guild.');
    return globals.length > 0 ? 1 : 0;
  }

  const primary = guilds[0]!;
  console.log(`  Checking against ${primary.name}`);

  const remote = (await rest.get(Routes.applicationGuildCommands(appId, primary.id))) as Array<{
    name: string;
    options?: OptionJson[];
  }>;

  // Right-click commands live in the same guild list as slash commands, so
  // they have to be counted here or every one of them reads as stale.
  const localNames = new Set([
    ...COMMANDS.map((c) => c.handler.data.name),
    ...CONTEXT_MENUS.map((c) => c.name),
  ]);
  const remoteNames = new Set(remote.map((c) => c.name));
  let failures = globals.length > 0 ? 1 : 0;

  for (const name of remoteNames) {
    if (!localNames.has(name)) {
      console.error(`  STALE  /${name} is registered on Discord but has no handler`);
      failures++;
    }
  }

  for (const name of localNames) {
    if (!remoteNames.has(name)) {
      console.error(
        `  MISSING  /${name} exists locally but is not registered — run register:commands`,
      );
      failures++;
    }
  }

  // Compare option names for commands present on both sides.
  for (const { builder } of COMMANDS) {
    const json = builder.toJSON();
    const remoteCommand = remote.find((c) => c.name === json.name);
    if (!remoteCommand) continue;

    const local = declaredOptionNames(json.options as OptionJson[] | undefined);
    const live = declaredOptionNames(remoteCommand.options);

    for (const option of local) {
      if (!live.has(option)) {
        console.error(`  DRIFT  /${json.name} option "${option}" is not registered on Discord`);
        failures++;
      }
    }
  }

  if (failures === 0) console.log('  Discord is in sync.');
  return failures;
}

const failures = checkLocalDefinitions() + (await compareWithDiscord());

if (failures > 0) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
