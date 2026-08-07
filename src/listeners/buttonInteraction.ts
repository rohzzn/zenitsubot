import type { Client, ButtonInteraction, GuildMember } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { shoukaku } from '../music/lavalink.js';
import { logger } from '../services/logger.js';
import { ZENITSU_THEME } from '../utils/constants.js';

/**
 * The music transport buttons.
 *
 * These legitimately read live state rather than stored state — the player and
 * queue belong to the voice connection, not to the message — so they stay here
 * rather than moving to the component router. Everything else that used this
 * file now keeps its state in the database instead.
 */
export default function registerButtonHandler(client: Client) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('music_')) return;

    await handleMusicButton(client, interaction as ButtonInteraction);
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
          await interaction.reply({ content: 'Resumed playback.', ephemeral: true });
        } else {
          await player.setPaused(true);
          await interaction.reply({ content: 'Paused playback.', ephemeral: true });
        }
        break;
      }

      case 'music_skip': {
        // Same path as /skip so the two can never drift apart.
        const advanced = await client.playerManager.advance(guildId);

        if (advanced) {
          const nextTrack = queue.now();
          const embed = new EmbedBuilder()
            .setColor(ZENITSU_THEME.PRIMARY)
            .setTitle('Skipped')
            .setDescription(
              nextTrack
                ? `Now playing: **${nextTrack.title}**\n${nextTrack.author}`
                : 'Playing next track',
            );

          if (nextTrack?.artworkUrl) embed.setThumbnail(nextTrack.artworkUrl);
          await interaction.reply({ embeds: [embed] });
        } else {
          await player.stopTrack();
          await interaction.reply({ content: 'Skipped. The queue is now empty.', ephemeral: true });
        }
        break;
      }

      case 'music_stop': {
        await player.stopTrack();
        // Via PlayerManager so the guild's wiring state is cleared too.
        await client.playerManager.destroy(guildId);

        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.ERROR)
          .setTitle('Playback stopped')
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
