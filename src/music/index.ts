import type { Client, GuildMember, VoiceBasedChannel } from 'discord.js';
import { createLavalink, shoukaku, search } from './lavalink.js';
import type { Node } from 'shoukaku';
import { GuildQueue } from './queue.js';
import type { Track } from './track.js';
import { logger } from '../services/logger.js';

export class PlayerManager {
  private client: Client;
  private queues = new Map<string, GuildQueue>();

  constructor(client: Client) {
    this.client = client;
    createLavalink(client);
  }

  getQueue(guildId: string): GuildQueue | undefined {
    return this.queues.get(guildId);
  }

  ensureQueue(guildId: string, channelId: string, opts?: { defaultVolume?: number; idleMinutes?: number }) {
    let q = this.queues.get(guildId);
    if (!q) {
      q = new GuildQueue({ guildId, channelId, defaultVolume: opts?.defaultVolume, idleMinutes: opts?.idleMinutes });
      this.queues.set(guildId, q);
    }
    return q;
  }

  async join(member: GuildMember, channel?: VoiceBasedChannel) {
    const voice = channel ?? member.voice.channel;
    if (!voice) throw new Error('You must be in a voice channel.');
    const connection = await shoukaku!.joinVoiceChannel({
      guildId: voice.guild.id,
      channelId: voice.id,
      shardId: voice.guild.shardId ?? 0,
      deaf: true,
    });
    return connection; // returns a Player
  }

  async play(guildId: string, track: { encoded: string }) {
    const player = shoukaku!.players.get(guildId);
    if (!player) throw new Error('Not connected to voice.');
    await player.playTrack({ track: { encoded: track.encoded } });
  }

  async search(query: string) {
    const node = (shoukaku!.nodes.values().next().value as Node)!;
    const identifier = /^(https?:)?\/\//i.test(query) ? query : `ytsearch:${query}`;
    const res = await search(node, identifier);
    return res;
  }
}

export function initPlayerManager(client: Client) {
  const pm = new PlayerManager(client);
  // Wire voice updates
  // Shoukaku handles voice via DiscordJS connector
  return pm;
}


