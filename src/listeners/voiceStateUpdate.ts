import type { Client, VoiceState } from 'discord.js';
import { shoukaku } from '../music/lavalink.js';

export function registerVoiceStateListener(client: Client) {
  client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
    const player = shoukaku?.players.get(newState.guild.id);
    if (!player) return;
    const connection = shoukaku?.connections.get(newState.guild.id);
    const channelId = connection?.channelId;
    if (!channelId) return;

    const channel = newState.guild.channels.cache.get(channelId);
    if (!channel || channel.isVoiceBased() === false) return;

    const members = channel.members.filter((m) => !m.user.bot);
    if (members.size === 0) {
      setTimeout(async () => {
        const stillMembers = channel.members.filter((m) => !m.user.bot);
        if (stillMembers.size === 0) {
          await player.destroy();
        }
      }, 60_000 * 5); // 5 minutes idle
    }
  });
}


