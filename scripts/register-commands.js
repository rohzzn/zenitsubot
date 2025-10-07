import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
function getEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env ${name}`);
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
            .addStringOption((o) => o.setName('query').setDescription('Query or URL').setRequired(true))
            .toJSON(),
        new SlashCommandBuilder().setName('pause').setDescription('Pause the player').toJSON(),
        new SlashCommandBuilder().setName('resume').setDescription('Resume the player').toJSON(),
        new SlashCommandBuilder().setName('skip').setDescription('Skip current track').toJSON(),
        new SlashCommandBuilder().setName('stop').setDescription('Stop and leave').toJSON(),
    ];
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('Registered global commands:', commands.map((c) => c.name).join(', '));
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=register-commands.js.map