import type { Client, VoiceState, VoiceBasedChannel } from 'discord.js';
import { shoukaku } from '../music/lavalink.js';
import { logger } from '../services/logger.js';

const IDLE_DISCONNECT_MS = 2 * 60 * 1000;

/** Pending idle-disconnect timers, keyed by guild, so rejoining cancels them. */
const leaveTimeouts = new Map<string, NodeJS.Timeout>();

function cancelIdleTimer(guildId: string) {
  const timer = leaveTimeouts.get(guildId);
  if (timer) {
    clearTimeout(timer);
    leaveTimeouts.delete(guildId);
  }
}

/**
 * Always tear down through PlayerManager. Calling player.destroy() and
 * leaveVoiceChannel() directly leaves the manager believing the guild's player
 * is still wired, so the next connection never gets queue-advance handlers and
 * playback silently stops after one track.
 */
async function teardown(client: Client, guildId: string, reason: string) {
  cancelIdleTimer(guildId);
  logger.info({ guildId, reason }, 'Tearing down voice connection');
  await client.playerManager.destroy(guildId);
}

export function registerVoiceStateListener(client: Client) {
  client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
    const guildId = newState.guild.id;

    if (!shoukaku?.players.get(guildId)) return;

    const botChannelId = shoukaku.connections.get(guildId)?.channelId;
    if (!botChannelId) return;

    const botChannel = newState.guild.channels.cache.get(botChannelId);

    if (!botChannel?.isVoiceBased()) {
      await teardown(client, guildId, 'voice channel gone');
      return;
    }

    // The bot itself was disconnected or dragged out of the channel.
    if (oldState.id === client.user?.id && oldState.channelId && !newState.channelId) {
      await teardown(client, guildId, 'bot disconnected from voice');
      return;
    }

    const listeners = (botChannel as VoiceBasedChannel).members.filter((m) => !m.user.bot);

    if (listeners.size > 0) {
      cancelIdleTimer(guildId);
      return;
    }

    if (leaveTimeouts.has(guildId)) return;

    const timer = setTimeout(() => {
      void (async () => {
        leaveTimeouts.delete(guildId);
        try {
          const channel = newState.guild.channels.cache.get(botChannelId);
          const stillEmpty =
            !channel?.isVoiceBased() ||
            (channel as VoiceBasedChannel).members.filter((m) => !m.user.bot).size === 0;

          if (stillEmpty) await teardown(client, guildId, 'idle, nobody listening');
        } catch (err) {
          logger.error({ err, guildId }, 'Idle disconnect failed');
        }
      })();
    }, IDLE_DISCONNECT_MS);

    leaveTimeouts.set(guildId, timer);
    logger.info({ guildId }, 'Started idle disconnect timer');
  });

  client.on('channelDelete', async (channel) => {
    if (!channel.isVoiceBased()) return;

    const guildId = channel.guild.id;
    if (!shoukaku?.players.get(guildId)) return;

    if (shoukaku.connections.get(guildId)?.channelId === channel.id) {
      await teardown(client, guildId, 'voice channel deleted');
    }
  });
}
