import { EmbedBuilder, type Client, type ChatInputCommandInteraction } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const csgo = {
  data: { name: 'csgo' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const steamInput = interaction.options.getString('steamid', true);

    if (subcommand === 'stats') {
      await showStats(interaction, steamInput);
    } else if (subcommand === 'inventory') {
      await showInventory(interaction, steamInput);
    }
  }
};

async function showStats(interaction: ChatInputCommandInteraction, steamInput: string) {
  try {
    await interaction.deferReply();

    // Extract Steam ID
    let steamId = steamInput;
    const urlMatch = steamInput.match(/steamcommunity\.com\/(id|profiles)\/([^\/]+)/);
    if (urlMatch) {
      steamId = urlMatch[2] || steamInput;
    }

    // Use CS:GO Stats API (free, no key required)
    const profileUrl = `https://steamcommunity.com/id/${steamId}`;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`${EMOTES.FLUENT_SPARKLES} CS:GO / CS2 Competitive Stats`)
      .setDescription(
        `**Steam Profile:** [${steamId}](${profileUrl})\n\n` +
        `**💡 How to view stats:**\n` +
        `${EMOTES.BULLET} Visit the Steam profile\n` +
        `${EMOTES.BULLET} Go to Games → Counter-Strike 2\n` +
        `${EMOTES.BULLET} Click "Personal Game Data"\n` +
        `${EMOTES.BULLET} View Stats & Achievements\n\u200b`
      )
      .setThumbnail('https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg')
      .addFields([
        {
          name: '🎯 Rank & Stats',
          value: 'CS:GO/CS2 stats are visible on the Steam profile if the profile is public.',
          inline: false
        },
        {
          name: '📊 Third-Party Trackers',
          value: 
            `${EMOTES.BULLET} [Leetify](https://leetify.com) - AI-powered analysis\n` +
            `${EMOTES.BULLET} [CS:GO Stats](https://csgostats.gg) - Detailed match history\n` +
            `${EMOTES.BULLET} [HLTV](https://www.hltv.org) - Pro scene & stats\n` +
            `${EMOTES.BULLET} [Scope.gg](https://scope.gg) - Performance tracking`,
          inline: false
        }
      ])
      .setImage('https://cdn.cloudflare.steamstatic.com/steam/apps/730/ss_d830cfd0550fbb64d80e803e93c929c3abb02056.1920x1080.jpg')
      .setFooter({ text: 'CS:GO / CS2 Stats Lookup ⚡' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    logger.error({ err }, 'CS:GO stats error');
    await interaction.editReply(`${EMOTES.YIKES} Failed to fetch CS:GO stats.`).catch(() => {});
  }
}

async function showInventory(interaction: ChatInputCommandInteraction, steamInput: string) {
  try {
    await interaction.deferReply();

    // Extract Steam ID
    let steamId = steamInput;
    const urlMatch = steamInput.match(/steamcommunity\.com\/(id|profiles)\/([^\/]+)/);
    if (urlMatch) {
      steamId = urlMatch[2] || steamInput;
    }

    const inventoryUrl = `https://steamcommunity.com/id/${steamId}/inventory/#730`;

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`${EMOTES.FLUENT_SPARKLES} CS:GO / CS2 Inventory`)
      .setDescription(
        `**View Inventory:**\n` +
        `[🎒 Open CS:GO Inventory](${inventoryUrl})\n\u200b`
      )
      .setThumbnail('https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg')
      .addFields([
        {
          name: '🎒 Access',
          value: 'CS:GO/CS2 inventory must be set to **public** to view.\nYou can check skins, stickers, cases, knives, and more!',
          inline: false
        },
        {
          name: '💰 Inventory Value Checkers',
          value: 
            `${EMOTES.BULLET} [CS:GO Float](https://csgofloat.com) - Float values & market\n` +
            `${EMOTES.BULLET} [CS:GO Exchange](https://csgo.exchange) - Inventory tracker\n` +
            `${EMOTES.BULLET} [Skinport](https://skinport.com) - Skin marketplace\n` +
            `${EMOTES.BULLET} [CSGOStash](https://csgostash.com) - Skin database`,
          inline: false
        },
        {
          name: '🔗 Quick Links',
          value: `${EMOTES.BULLET} [Steam Profile](https://steamcommunity.com/id/${steamId})`,
          inline: false
        }
      ])
      .setImage('https://cdn.cloudflare.steamstatic.com/steam/apps/730/ss_d1a8e85cc3d73ab724326856d6c46d8b09a5f348.1920x1080.jpg')
      .setFooter({ text: 'CS:GO / CS2 Inventory Lookup ⚡' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    logger.error({ err }, 'CS:GO inventory error');
    await interaction.editReply(`${EMOTES.YIKES} Failed to fetch CS:GO inventory.`).catch(() => {});
  }
}



