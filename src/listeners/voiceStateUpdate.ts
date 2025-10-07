import type { Client, VoiceState, VoiceBasedChannel } from 'discord.js';
import { shoukaku } from '../music/lavalink.js';
import { logger } from '../services/logger.js';

// Track timeouts to clear them if users rejoin
const leaveTimeouts = new Map<string, NodeJS.Timeout>();

export function registerVoiceStateListener(client: Client) {
  client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
    const guildId = newState.guild.id;
    const player = shoukaku?.players.get(guildId);
    
    // If no player exists in this guild, nothing to manage
    if (!player) return;
    
    const connection = shoukaku?.connections.get(guildId);
    const botChannelId = connection?.channelId;
    
    if (!botChannelId) return;

    // Get the bot's voice channel
    const botChannel = newState.guild.channels.cache.get(botChannelId);
    
    // Edge case 1: Channel was deleted
    if (!botChannel) {
      logger.info({ guildId }, 'Voice channel deleted, leaving');
      clearTimeout(leaveTimeouts.get(guildId));
      leaveTimeouts.delete(guildId);
      await player.destroy();
      shoukaku?.leaveVoiceChannel(guildId);
      client.playerManager?.getQueue(guildId)?.clear();
      return;
    }

    // Ensure it's a voice-based channel
    if (!botChannel.isVoiceBased()) return;

    // Edge case 2: Check if bot was moved or kicked
    if (oldState.id === client.user?.id) {
      // Bot was moved to a different channel
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        logger.info({ guildId, oldChannel: oldState.channelId, newChannel: newState.channelId }, 'Bot moved/kicked from voice');
        clearTimeout(leaveTimeouts.get(guildId));
        leaveTimeouts.delete(guildId);
        
        // If bot was kicked (no new channel), clean up
        if (!newState.channelId) {
          await player.destroy();
          shoukaku?.leaveVoiceChannel(guildId);
          client.playerManager?.getQueue(guildId)?.clear();
          return;
        }
      }
    }

    // Edge case 3: Check if all non-bot members left the channel
    const typedChannel = botChannel as VoiceBasedChannel;
    const members = typedChannel.members.filter((m) => !m.user.bot);
    
    if (members.size === 0) {
      // Clear any existing timeout for this guild
      if (leaveTimeouts.has(guildId)) {
        clearTimeout(leaveTimeouts.get(guildId));
      }

      // Set new timeout
      const timeout = setTimeout(async () => {
        try {
          // Re-check if channel still exists and is still empty
          const currentChannel = newState.guild.channels.cache.get(botChannelId);
          
          if (!currentChannel || !currentChannel.isVoiceBased()) {
            // Channel deleted
            logger.info({ guildId }, 'Channel deleted during idle timeout');
            await player.destroy();
            shoukaku?.leaveVoiceChannel(guildId);
            client.playerManager?.getQueue(guildId)?.clear();
            leaveTimeouts.delete(guildId);
            return;
          }

          const currentTypedChannel = currentChannel as VoiceBasedChannel;
          const currentMembers = currentTypedChannel.members.filter((m) => !m.user.bot);
          
          if (currentMembers.size === 0) {
            logger.info({ guildId }, 'No members after idle timeout, leaving voice');
            await player.destroy();
            shoukaku?.leaveVoiceChannel(guildId);
            client.playerManager?.getQueue(guildId)?.clear();
          }
        } catch (err) {
          logger.error({ err, guildId }, 'Error during idle timeout cleanup');
        } finally {
          leaveTimeouts.delete(guildId);
        }
      }, 60_000 * 2); // 2 minutes idle (reduced from 5)

      leaveTimeouts.set(guildId, timeout);
      logger.info({ guildId }, 'Started idle disconnect timer (2 minutes)');
    } else {
      // Members are present, clear any pending timeout
      if (leaveTimeouts.has(guildId)) {
        clearTimeout(leaveTimeouts.get(guildId));
        leaveTimeouts.delete(guildId);
        logger.info({ guildId }, 'Cancelled idle disconnect timer (members present)');
      }
    }
  });

  // Edge case 4: Handle channel deletions
  client.on('channelDelete', async (channel) => {
    if (!channel.isVoiceBased()) return;
    
    const guildId = channel.guild.id;
    const player = shoukaku?.players.get(guildId);
    if (!player) return;

    const connection = shoukaku?.connections.get(guildId);
    if (connection?.channelId === channel.id) {
      logger.info({ guildId, channelId: channel.id }, 'Bot voice channel deleted');
      clearTimeout(leaveTimeouts.get(guildId));
      leaveTimeouts.delete(guildId);
      await player.destroy();
      shoukaku?.leaveVoiceChannel(guildId);
      client.playerManager?.getQueue(guildId)?.clear();
    }
  });
}


