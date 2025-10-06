import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../utils/constants.js';

export const help = {
  data: { name: 'help' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`${EMOTES.FLUENT_SPARKLES} Zenitsu Bot - Command List`)
      .setDescription('All available commands organized by category')
      .addFields([
        {
          name: `🎵 Music Commands (13)`,
          value: 
            `${EMOTES.BULLET} \`/join\` - Join your voice channel\n` +
            `${EMOTES.BULLET} \`/play <song/url>\` - Play music (YouTube, Spotify playlists)\n` +
            `${EMOTES.BULLET} \`/pause\` - Pause current track\n` +
            `${EMOTES.BULLET} \`/resume\` - Resume playback\n` +
            `${EMOTES.BULLET} \`/skip\` - Skip to next track\n` +
            `${EMOTES.BULLET} \`/stop\` - Stop and clear queue\n` +
            `${EMOTES.BULLET} \`/queue\` - View current queue\n` +
            `${EMOTES.BULLET} \`/now\` - Show now playing\n` +
            `${EMOTES.BULLET} \`/volume <1-100>\` - Adjust volume\n` +
            `${EMOTES.BULLET} \`/loop <mode>\` - Set loop (off/track/queue)\n` +
            `${EMOTES.BULLET} \`/shuffle\` - Shuffle the queue\n` +
            `${EMOTES.BULLET} \`/remove <position>\` - Remove track from queue`,
          inline: false
        },
        {
          name: `🛡️ Moderation Commands (4)`,
          value: 
            `${EMOTES.BULLET} \`/kick <user> [reason]\` - Kick a member\n` +
            `${EMOTES.BULLET} \`/ban <user> [reason]\` - Ban a member\n` +
            `${EMOTES.BULLET} \`/mute <user> <duration> [reason]\` - Timeout a user\n` +
            `${EMOTES.BULLET} \`/purge <count>\` - Bulk delete messages (1-100)`,
          inline: false
        },
        {
          name: `🔧 Utility Commands (4)`,
          value: 
            `${EMOTES.BULLET} \`/ping\` - Check bot latency\n` +
            `${EMOTES.BULLET} \`/help\` - Show this help message\n` +
            `${EMOTES.BULLET} \`/avatar [user]\` - Show user avatar\n` +
            `${EMOTES.BULLET} \`/server\` - Server information\n` +
            `${EMOTES.BULLET} \`/user [user]\` - User information`,
          inline: false
        },
        {
          name: `📺 Anime Commands (6)`,
          value: 
            `${EMOTES.BULLET} \`/anime\` - Anime commands help\n` +
            `${EMOTES.BULLET} \`/animesearch <query>\` - Search MyAnimeList\n` +
            `${EMOTES.BULLET} \`/animeinfo <name>\` - Detailed anime info\n` +
            `${EMOTES.BULLET} \`/animecharacter <name>\` - Character info\n` +
            `${EMOTES.BULLET} \`/animeupcoming\` - Top 5 upcoming episodes\n` +
            `${EMOTES.BULLET} \`/animealert\` - Manage episode alerts`,
          inline: false
        },
        {
          name: `💰 Economy Commands (3)`,
          value: 
            `${EMOTES.BULLET} \`/balance\` - Check your coins & level\n` +
            `${EMOTES.BULLET} \`/daily\` - Claim daily coins (1000)\n` +
            `${EMOTES.BULLET} \`/leaderboard\` - Server leaderboard`,
          inline: false
        },
        {
          name: `🎲 Fun & Games (4)`,
          value: 
            `${EMOTES.BULLET} \`/8ball <question>\` - Ask the magic 8-ball\n` +
            `${EMOTES.BULLET} \`/blackjack <bet>\` - Play blackjack\n` +
            `${EMOTES.BULLET} \`/animequote\` - Random anime quotes\n` +
            `${EMOTES.BULLET} \`/icebreaker\` - Conversation starters`,
          inline: false
        },
        {
          name: `🎮 Gaming Commands (3)`,
          value: 
            `${EMOTES.BULLET} \`/steamsearch game <query>\` - Search Steam games\n` +
            `${EMOTES.BULLET} \`/steamsearch player <id>\` - Steam player lookup\n` +
            `${EMOTES.BULLET} \`/freegames\` - Current free games (Epic/Steam)\n` +
            `${EMOTES.BULLET} \`/gamesearch <game>\` - Game info with ratings`,
          inline: false
        },
        {
          name: `⚙️ Admin Commands (2)`,
          value: 
            `${EMOTES.BULLET} \`/welcome setup\` - Configure welcome messages\n` +
            `${EMOTES.BULLET} \`/streamalert\` - YouTube/Twitch alerts`,
          inline: false
        }
      ])
      .setFooter({ text: `Total: 38 Commands • Made with ⚡ by Zenitsu Bot` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};


