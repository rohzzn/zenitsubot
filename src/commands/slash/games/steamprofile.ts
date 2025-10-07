import { EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';
import { loadConfig } from '../../../services/config.js';

export const steamprofile = {
  data: { name: 'steamprofile' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const steamInput = interaction.options.getString('steamid', true);
    
    // Extract Steam ID from URL if provided
    let steamId = steamInput;
    const urlMatch = steamInput.match(/steamcommunity\.com\/(id|profiles)\/([^\/]+)/);
    if (urlMatch) {
      steamId = urlMatch[2] || steamInput;
    }

    // Note: Full Steam API requires API key
    // For basic info, we'll show what we can
    const profileUrl = steamInput.includes('steamcommunity.com') 
      ? steamInput 
      : `https://steamcommunity.com/id/${steamId}`;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`${EMOTES.FLUENT_SPARKLES} Steam Profile Lookup`)
      .setDescription(`[🔗 View Full Profile on Steam](${profileUrl})\n\u200b`)
      .setThumbnail('https://store.cloudflare.steamstatic.com/public/shared/images/header/logo_steam.svg')
      .addFields([
        {
          name: '🎮 Profile Details',
          value: `**Steam ID/URL:** \`${steamId}\`\n\u200b`,
          inline: false
        },
        {
          name: '💡 What You Can See',
          value: 
            `${EMOTES.BULLET} Games owned & wishlist\n` +
            `${EMOTES.BULLET} Achievements & badges\n` +
            `${EMOTES.BULLET} Play time & stats\n` +
            `${EMOTES.BULLET} Friends list & groups\n` +
            `${EMOTES.BULLET} Recent activity & screenshots\n\u200b`,
          inline: false
        },
        {
          name: '🔗 Related Commands',
          value: 
            `${EMOTES.BULLET} \`/csgo stats <id>\` - CS:GO/CS2 competitive stats\n` +
            `${EMOTES.BULLET} \`/csgo inventory <id>\` - CS:GO/CS2 inventory`,
          inline: false
        },
        {
          name: '📊 Third-Party Tools',
          value: 
            `${EMOTES.BULLET} [SteamDB](https://steamdb.info) - Database & analytics\n` +
            `${EMOTES.BULLET} [Steam Ladder](https://steamladder.com) - Rankings\n` +
            `${EMOTES.BULLET} [SteamID.io](https://steamid.io) - ID converter`,
          inline: false
        }
      ])
      .setImage('https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/items/1091500/0e06c2cb9e5f80c2e5aaef7c32b7e1e73faadc1d.jpg')
      .setFooter({ text: 'Steam Profile Lookup ⚡' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    logger.error({ err }, 'Steam profile error');
    await interaction.editReply(`${EMOTES.YIKES} Failed to fetch Steam profile.`).catch(() => {});
  }
  }
};



