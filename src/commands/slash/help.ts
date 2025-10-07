import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { ZENITSU_THEME, EMOTES } from '../../utils/constants.js';

const CATEGORIES = {
  overview: {
    name: 'Overview',
    emoji: '📋',
    description: 'See all command categories'
  },
  music: {
    name: 'Music',
    emoji: '🎵',
    commands: [
      '`/join` - Join your voice channel',
      '`/play <song/url>` - Play music (YouTube, Spotify playlists)',
      '`/pause` - Pause current track',
      '`/resume` - Resume playback',
      '`/skip` - Skip to next track',
      '`/stop` - Stop and clear queue',
      '`/queue` - View current queue',
      '`/now` - Show now playing with album art',
      '`/volume <1-100>` - Adjust volume',
      '`/loop <mode>` - Set loop (off/track/queue)',
      '`/shuffle` - Shuffle the queue',
      '`/remove <position>` - Remove track from queue',
      '`/leave` - Leave voice channel'
    ]
  },
  moderation: {
    name: 'Moderation',
    emoji: '🛡️',
    commands: [
      '`/kick <user> [reason]` - Kick a member',
      '`/ban <user> [reason]` - Ban a member',
      '`/mute <user> <duration> [reason]` - Timeout a user',
      '`/purge <count>` - Bulk delete messages (1-100)'
    ]
  },
  utility: {
    name: 'Utility',
    emoji: '🔧',
    commands: [
      '`/ping` - Check bot latency',
      '`/help` - Show this interactive help menu',
      '`/avatar [user]` - Show user avatar',
      '`/server` - Server information',
      '`/user [user]` - User information'
    ]
  },
  anime: {
    name: 'Anime',
    emoji: '📺',
    commands: [
      '`/anime` - Anime commands help',
      '`/animesearch <query>` - Search MyAnimeList',
      '`/animeinfo <name>` - Detailed anime info with reviews',
      '`/animecharacter <name>` - Character info & voice actors',
      '`/animeupcoming` - Top 5 upcoming anime episodes',
      '`/animealert` - Manage episode alerts',
      '`/animairing` - Current airing anime this season'
    ]
  },
  economy: {
    name: 'Economy',
    emoji: '💰',
    commands: [
      '`/balance` - Check your coins & level',
      '`/daily` - Claim daily coins',
      '`/work` - Work to earn coins',
      '`/rob` - Rob other users (risky)',
      '`/gift` - Send coins to others',
      '`/rank` - View rank card',
      '`/shop` - Buy items',
      '`/inventory` - View owned items',
      '`/leaderboard` - Global leaderboard'
    ]
  },
  fun: {
    name: 'Fun & Games',
    emoji: '🎲',
    commands: [
      '`/8ball <question>` - Ask the magic 8-ball',
      '`/blackjack <bet>` - Play blackjack',
      '`/slots <bet>` - Slot machine',
      '`/coinflip <bet>` - Coin flip gambling',
      '`/dice <bet>` - Dice roll gambling',
      '`/meme` - Random memes',
      '`/animequote` - Random anime quotes',
      '`/icebreaker` - Conversation starters',
      '`/hug [@user]` - Hug with cute GIF',
      '`/kiss [@user]` - Kiss with cute GIF',
      '`/cuddle [@user]` - Cuddle with cute GIF',
      '`/slap [@user]` - Slap with anime GIF',
      '`/punch [@user]` - Punch with anime GIF',
      '`/kickfun [@user]` - Kick with anime GIF'
    ]
  },
  gaming: {
    name: 'Gaming',
    emoji: '🎮',
    commands: [
      '`/steamsearch game <query>` - Search Steam games',
      '`/steamsearch player <id>` - Steam player lookup',
      '`/steamprofile <id>` - Detailed Steam profile',
      '`/csgo inventory <id>` - CS:GO inventory viewer',
      '`/csgo stats <id>` - CS:GO competitive stats',
      '`/faceit <username>` - Faceit profile & stats',
      '`/freegames` - Current free games (Epic/Steam)',
      '`/gamesearch <game>` - Game info with ratings'
    ]
  },
  admin: {
    name: 'Admin',
    emoji: '⚙️',
    commands: [
      '`/welcome setup` - Configure welcome messages',
      '`/streamalert` - YouTube/Twitch stream alerts'
    ]
  }
};

function createOverviewEmbed() {
  return new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle(`${EMOTES.FLUENT_SPARKLES} Zenitsu Bot - Help Menu`)
    .setDescription('**Select a category below to view commands**\n\u200b')
    .addFields([
      {
        name: '\u200b',
        value: 
          `${CATEGORIES.music.emoji} **Music** - 13 commands\n` +
          `${CATEGORIES.moderation.emoji} **Moderation** - 4 commands\n` +
          `${CATEGORIES.utility.emoji} **Utility** - 5 commands\n` +
          `${CATEGORIES.anime.emoji} **Anime** - 7 commands\n\u200b`,
        inline: true
      },
      {
        name: '\u200b',
        value:
          `${CATEGORIES.economy.emoji} **Economy** - 3 commands\n` +
          `${CATEGORIES.fun.emoji} **Fun & Games** - 4 commands\n` +
          `${CATEGORIES.gaming.emoji} **Gaming** - 8 commands\n` +
          `${CATEGORIES.admin.emoji} **Admin** - 2 commands\n\u200b`,
        inline: true
      }
    ])
    .setFooter({ text: 'Total: 46 Commands • Use buttons below to navigate' })
    .setTimestamp();
}

function createCategoryEmbed(category: keyof typeof CATEGORIES) {
  if (category === 'overview') {
    return createOverviewEmbed();
  }

  const cat = CATEGORIES[category];
  return new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle(`${cat.emoji} ${cat.name} Commands`)
    .setDescription(
      `**Available ${cat.name} Commands:**\n\n` +
      cat.commands!.map(cmd => `${EMOTES.BULLET} ${cmd}`).join('\n') +
      '\n\u200b'
    )
    .setFooter({ text: `${cat.commands!.length} commands in this category` })
    .setTimestamp();
}

function createNavigationButtons(currentCategory: string = 'overview') {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('help_overview')
      .setLabel('Overview')
      .setEmoji(CATEGORIES.overview.emoji)
      .setStyle(currentCategory === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_music')
      .setLabel('Music')
      .setEmoji(CATEGORIES.music.emoji)
      .setStyle(currentCategory === 'music' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_moderation')
      .setLabel('Moderation')
      .setEmoji(CATEGORIES.moderation.emoji)
      .setStyle(currentCategory === 'moderation' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_utility')
      .setLabel('Utility')
      .setEmoji(CATEGORIES.utility.emoji)
      .setStyle(currentCategory === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('help_anime')
      .setLabel('Anime')
      .setEmoji(CATEGORIES.anime.emoji)
      .setStyle(currentCategory === 'anime' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_economy')
      .setLabel('Economy')
      .setEmoji(CATEGORIES.economy.emoji)
      .setStyle(currentCategory === 'economy' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_fun')
      .setLabel('Fun')
      .setEmoji(CATEGORIES.fun.emoji)
      .setStyle(currentCategory === 'fun' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('help_gaming')
      .setLabel('Gaming')
      .setEmoji(CATEGORIES.gaming.emoji)
      .setStyle(currentCategory === 'gaming' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('help_admin')
      .setLabel('Admin')
      .setEmoji(CATEGORIES.admin.emoji)
      .setStyle(currentCategory === 'admin' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return [row1, row2, row3];
}

export const help = {
  data: { name: 'help' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
    const embed = createOverviewEmbed();
    const buttons = createNavigationButtons('overview');

    const response = await interaction.reply({
      embeds: [embed],
      components: buttons,
      ephemeral: true,
      fetchReply: true
    });

    // Create collector for button interactions
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000 // 5 minutes
    });

    collector.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.user.id !== interaction.user.id) {
        await buttonInteraction.reply({
          content: 'This help menu is not for you!',
          ephemeral: true
        });
        return;
      }

      const category = buttonInteraction.customId.replace('help_', '') as keyof typeof CATEGORIES;
      const newEmbed = createCategoryEmbed(category);
      const newButtons = createNavigationButtons(category);

      await buttonInteraction.update({
        embeds: [newEmbed],
        components: newButtons
      });
    });

    collector.on('end', async () => {
      // Disable all buttons after timeout
      const disabledButtons = createNavigationButtons().map(row =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...row.components.map(button =>
            ButtonBuilder.from(button).setDisabled(true)
          )
        )
      );

      await interaction.editReply({ components: disabledButtons }).catch(() => {});
    });
  },
};
