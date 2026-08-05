import type { Client, ButtonInteraction, GuildMember } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { shoukaku } from '../music/lavalink.js';
import { logger } from '../services/logger.js';
import { ZENITSU_THEME } from '../utils/constants.js';
import { getPrisma } from '../services/db.js';
import { activeGames, calculateHand, formatHand } from '../commands/slash/fun/blackjack.js';

export default function registerButtonHandler(client: Client) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const buttonInteraction = interaction as ButtonInteraction;

    // Music button handlers
    if (buttonInteraction.customId.startsWith('music_')) {
      await handleMusicButton(client, buttonInteraction);
    }

    // Blackjack button handlers
    if (buttonInteraction.customId.startsWith('bj_')) {
      await handleBlackjackButton(client, buttonInteraction);
    }
  });
}

async function handleMusicButton(client: Client, interaction: ButtonInteraction) {
  const member = interaction.member as GuildMember;
  const guildId = interaction.guildId!;
  const player = shoukaku?.players.get(guildId);
  const pm = client.playerManager;
  const queue = pm.getQueue(guildId);

  if (!player || !queue) {
    await interaction.reply({ content: 'Nothing is currently playing.', ephemeral: true });
    return;
  }

  // Check if user is in the same voice channel
  const connection = shoukaku?.connections.get(guildId);
  const botChannelId = connection?.channelId;

  if (!member.voice.channel || !botChannelId || member.voice.channel.id !== botChannelId) {
    await interaction.reply({
      content: 'You must be in the same voice channel as the bot!',
      ephemeral: true,
    });
    return;
  }

  try {
    switch (interaction.customId) {
      case 'music_pause': {
        if (player.paused) {
          await player.setPaused(false);
          await interaction.reply({ content: '▶ Resumed playback.', ephemeral: true });
        } else {
          await player.setPaused(true);
          await interaction.reply({ content: '⏸ Paused playback.', ephemeral: true });
        }
        break;
      }

      case 'music_skip': {
        const nextTrack = queue.next();
        if (nextTrack) {
          await player.playTrack({ track: { encoded: nextTrack.encoded } });

          const embed = new EmbedBuilder()
            .setColor(0x1db954)
            .setTitle('⏭ Skipped')
            .setDescription(`Now playing: **${nextTrack.title}**\n${nextTrack.author}`)
            .setThumbnail(nextTrack.artworkUrl || null);

          await interaction.reply({ embeds: [embed] });
        } else {
          await player.stopTrack();
          await interaction.reply({ content: '⏭ Skipped. Queue is now empty.', ephemeral: true });
        }
        break;
      }

      case 'music_stop': {
        queue.clear();
        await player.stopTrack();
        shoukaku?.leaveVoiceChannel(guildId);

        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('⏹ Playback Stopped')
          .setDescription('Cleared the queue and left the voice channel.');

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'music_queue': {
        const tracks = queue.list();
        const current = queue.now();

        if (tracks.length === 0) {
          await interaction.reply({ content: 'Queue is empty.', ephemeral: true });
          return;
        }

        const queuePages = [];
        const tracksPerPage = 10;

        for (let i = 0; i < tracks.length; i += tracksPerPage) {
          const page = tracks.slice(i, i + tracksPerPage);
          const description = page
            .map((t, idx) => {
              const position = i + idx;
              const isCurrent = current && t.encoded === current.encoded;
              const prefix = isCurrent ? '' : `${position + 1}.`;
              return `${prefix} **${t.title}** - ${t.author} \`[${formatDuration(t.duration)}]\``;
            })
            .join('\n');

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('Music Queue')
            .setDescription(description || 'Queue is empty')
            .setFooter({
              text: `Page ${Math.floor(i / tracksPerPage) + 1}/${Math.ceil(tracks.length / tracksPerPage)} • ${tracks.length} total tracks • Loop: ${queue.loop}`,
            });

          queuePages.push(embed);
        }

        await interaction.reply({ embeds: [queuePages[0]!], ephemeral: true });
        break;
      }

      case 'music_loop': {
        // Cycle through loop modes: off -> track -> queue -> off
        if (queue.loop === 'off') {
          queue.loop = 'track';
          await interaction.reply({ content: 'Loop mode: **Track**', ephemeral: true });
        } else if (queue.loop === 'track') {
          queue.loop = 'queue';
          await interaction.reply({ content: 'Loop mode: **Queue**', ephemeral: true });
        } else {
          queue.loop = 'off';
          await interaction.reply({ content: 'Loop mode: **Off**', ephemeral: true });
        }
        break;
      }

      default:
        await interaction.reply({ content: 'Unknown button.', ephemeral: true });
    }
  } catch (err: any) {
    logger.error({ err, customId: interaction.customId }, 'Button interaction error');
    await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }).catch(() => {});
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hrs = Math.floor(mins / 60);
  const finalMins = mins % 60;

  if (hrs > 0) {
    return `${hrs}:${finalMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${finalMins}:${secs.toString().padStart(2, '0')}`;
}

async function handleBlackjackButton(client: Client, interaction: ButtonInteraction) {
  const userId = interaction.customId.split('_')[2];

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'This is not your game!', ephemeral: true });
    return;
  }

  const game = activeGames.get(userId!);
  if (!game) {
    await interaction.reply({ content: 'Game expired or not found!', ephemeral: true });
    return;
  }

  const prisma = getPrisma();
  const action = interaction.customId.split('_')[1];

  try {
    if (action === 'hit') {
      // Draw a card
      game.playerHand.push(game.deck.pop());
      const playerTotal = calculateHand(game.playerHand);

      if (playerTotal > 21) {
        // Bust!
        const userEcon = await prisma.userEconomy.findUnique({ where: { userId: game.userId } });
        await prisma.userEconomy.update({
          where: { userId: game.userId },
          data: {
            coins: { decrement: game.bet },
            totalWagered: { increment: game.bet },
            gamesPlayed: { increment: 1 },
          },
        });

        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.ERROR)
          .setTitle('Bust!')
          .setDescription(`You went over 21! Lost **${game.bet}** coins!`)
          .addFields([
            {
              name: 'Your Hand',
              value: `${formatHand(game.playerHand)}\nTotal: **${playerTotal}**`,
            },
            {
              name: 'Dealer',
              value: `${formatHand(game.dealerHand)}\nTotal: **${calculateHand(game.dealerHand)}**`,
            },
          ]);

        activeGames.delete(userId!);
        await interaction.update({ embeds: [embed], components: [] });
      } else {
        // Update with new card
        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.PRIMARY)
          .setTitle('Blackjack')
          .setDescription(`Bet: **${game.bet}** coins`)
          .addFields([
            {
              name: 'Your Hand',
              value: `${formatHand(game.playerHand)}\nTotal: **${playerTotal}**`,
            },
            {
              name: 'Dealer',
              value: `${game.dealerHand[0]!.value}${game.dealerHand[0]!.suit} [hidden]`,
            },
          ]);

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`bj_hit_${userId}`)
            .setLabel('Hit')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`bj_stand_${userId}`)
            .setLabel('Stand')
            .setStyle(ButtonStyle.Secondary),
        );

        await interaction.update({ embeds: [embed], components: [buttons] });
      }
    } else if (action === 'stand' || action === 'double') {
      let finalBet = game.bet;

      if (action === 'double') {
        finalBet = game.bet * 2;
        game.playerHand.push(game.deck.pop());
      }

      // Dealer plays
      let dealerTotal = calculateHand(game.dealerHand);
      while (dealerTotal < 17) {
        game.dealerHand.push(game.deck.pop());
        dealerTotal = calculateHand(game.dealerHand);
      }

      const playerTotal = calculateHand(game.playerHand);
      let result = '';
      let color = ZENITSU_THEME.PRIMARY;
      let coinChange = 0;

      if (playerTotal > 21) {
        result = `Bust! Lost **${finalBet}** coins!`;
        color = ZENITSU_THEME.ERROR;
        coinChange = -finalBet;
      } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
        result = `You Win! Won **${finalBet}** coins!`;
        color = ZENITSU_THEME.SUCCESS;
        coinChange = finalBet;
      } else if (playerTotal < dealerTotal) {
        result = `Dealer Wins! Lost **${finalBet}** coins!`;
        color = ZENITSU_THEME.ERROR;
        coinChange = -finalBet;
      } else {
        result = `Push! Bet returned.`;
        color = ZENITSU_THEME.PRIMARY;
        coinChange = 0;
      }

      // Update coins and stats
      const userEcon = await prisma.userEconomy.findUnique({ where: { userId: game.userId } });
      await prisma.userEconomy.update({
        where: { userId: game.userId },
        data: {
          coins: { increment: coinChange },
          totalWagered: { increment: game.bet },
          totalWon: { increment: coinChange > 0 ? coinChange + game.bet : 0 },
          gamesPlayed: { increment: 1 },
        },
      });

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('Game Over!')
        .setDescription(result)
        .addFields([
          {
            name: 'Your Hand',
            value: `${formatHand(game.playerHand)}\nTotal: **${playerTotal}**`,
            inline: true,
          },
          {
            name: 'Dealer',
            value: `${formatHand(game.dealerHand)}\nTotal: **${dealerTotal}**`,
            inline: true,
          },
        ]);

      activeGames.delete(userId!);
      await interaction.update({ embeds: [embed], components: [] });
    }
  } catch (err: any) {
    logger.error({ err }, 'Blackjack button error');
    await interaction.reply({ content: 'An error occurred!', ephemeral: true }).catch(() => {});
  }
}
