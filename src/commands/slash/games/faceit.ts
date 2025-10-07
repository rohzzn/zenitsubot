import { EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const faceit = {
  data: { name: 'faceit' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const username = interaction.options.getString('username', true);

    // Faceit public API (no key required for basic data)
    const searchUrl = `https://open.faceit.com/data/v4/search/players?nickname=${encodeURIComponent(username)}&offset=0&limit=1`;
    
    try {
      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Player not found');
      }

      const data = await response.json() as any;
      
      if (!data.items || data.items.length === 0) {
        await interaction.editReply(`${EMOTES.CONFUSED_CAT} No player found with username: **${username}**`);
        return;
      }

      const player = data.items[0];
      
      // Get player details
      const playerUrl = `https://open.faceit.com/data/v4/players/${player.player_id}`;
      const playerResponse = await fetch(playerUrl, {
        headers: {
          'Accept': 'application/json'
        }
      });

      let playerData = player;
      if (playerResponse.ok) {
        playerData = await playerResponse.json();
      }

      const csgoGame = playerData.games?.csgo || playerData.games?.cs2;
      const elo = csgoGame?.faceit_elo || 'N/A';
      const level = csgoGame?.skill_level || 'N/A';
      const region = playerData.games?.csgo?.region || playerData.region || 'N/A';

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`${EMOTES.FLUENT_SPARKLES} Faceit Profile`)
        .setDescription(
          `**${playerData.nickname}**\n` +
          `[View on Faceit](https://www.faceit.com/en/players/${playerData.nickname})\n\u200b`
        )
        .addFields([
          {
            name: '🎮 Player Info',
            value: 
              `${EMOTES.BULLET} **Country:** ${playerData.country || 'Unknown'}\n` +
              `${EMOTES.BULLET} **Region:** ${region}\n` +
              `${EMOTES.BULLET} **Member Since:** ${playerData.activated_at ? new Date(playerData.activated_at).toLocaleDateString() : 'Unknown'}\n\u200b`,
            inline: false
          },
          {
            name: '⚡ CS:GO / CS2 Stats',
            value: csgoGame ? 
              `${EMOTES.BULLET} **Level:** ${level} ${getLevelEmoji(level)}\n` +
              `${EMOTES.BULLET} **Elo:** ${elo}\n` +
              `${EMOTES.BULLET} **Region:** ${csgoGame.region || 'N/A'}\n\u200b` :
              'No CS:GO/CS2 data available\n\u200b',
            inline: false
          },
          {
            name: '🔗 Links',
            value: 
              `${EMOTES.BULLET} [Faceit Profile](https://www.faceit.com/en/players/${playerData.nickname})\n` +
              `${EMOTES.BULLET} [Match History](https://www.faceit.com/en/players/${playerData.nickname}/stats/cs2)\n\u200b`,
            inline: false
          }
        ])
        .setThumbnail(playerData.avatar || 'https://www.faceit.com/favicon.ico')
        .setFooter({ text: 'Faceit Stats Lookup ⚡' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (apiErr) {
      // Fallback to profile link if API fails
      const profileUrl = `https://www.faceit.com/en/players/${username}`;
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`${EMOTES.FLUENT_SPARKLES} Faceit Profile`)
        .setDescription(
          `**Searching for:** ${username}\n\n` +
          `[View Profile on Faceit](${profileUrl})\n\u200b`
        )
        .setThumbnail('https://faceit-client.faceit-cdn.net/assets/images/faceit-logo.svg')
        .addFields([
          {
            name: '💡 Note',
            value: 'Could not fetch detailed stats from API. Visit the profile link to see full information.',
            inline: false
          }
        ])
        .setImage('https://distribution.faceit-cdn.net/images/bd2f4fd3-5cf6-4e03-abef-06bb27627da5.jpeg')
        .setFooter({ text: 'Faceit Lookup ⚡' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err: any) {
    logger.error({ err }, 'Faceit command error');
    await interaction.editReply(`${EMOTES.YIKES} An error occurred while searching Faceit.`).catch(() => {});
  }
  }
};

function getLevelEmoji(level: number | string): string {
  const lvl = typeof level === 'string' ? parseInt(level) : level;
  if (lvl >= 10) return '🏆';
  if (lvl >= 7) return '💎';
  if (lvl >= 4) return '⚔️';
  return '🎮';
}



