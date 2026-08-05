import type { Client, GuildMember, VoiceBasedChannel } from 'discord.js';
import { createLavalink, shoukaku, search } from './lavalink.js';
import type { Node, Player } from 'shoukaku';
import { GuildQueue } from './queue.js';
import { logger } from '../services/logger.js';

export class PlayerManager {
  private client: Client;
  private queues = new Map<string, GuildQueue>();
  /** Guilds whose player already has our lifecycle handlers attached. */
  private wired = new Set<string>();

  constructor(client: Client) {
    this.client = client;
    createLavalink(client);
  }

  getQueue(guildId: string): GuildQueue | undefined {
    return this.queues.get(guildId);
  }

  ensureQueue(
    guildId: string,
    channelId: string,
    opts?: { defaultVolume?: number; idleMinutes?: number },
  ) {
    let q = this.queues.get(guildId);
    if (!q) {
      q = new GuildQueue({
        guildId,
        channelId,
        defaultVolume: opts?.defaultVolume,
        idleMinutes: opts?.idleMinutes,
      });
      this.queues.set(guildId, q);
    }
    return q;
  }

  /**
   * Connects to voice if needed and returns the player with queue-advance
   * handlers attached. Safe to call repeatedly — handlers are wired once per
   * guild, so `/join` followed by `/play` still advances the queue.
   */
  async ensurePlayer(channel: VoiceBasedChannel): Promise<Player> {
    const guildId = channel.guild.id;
    let player = shoukaku!.players.get(guildId);

    if (!player) {
      player = await shoukaku!.joinVoiceChannel({
        guildId,
        channelId: channel.id,
        shardId: channel.guild.shardId ?? 0,
        deaf: true,
      });
    }

    if (!this.wired.has(guildId)) {
      this.wirePlayer(guildId, player);
      this.wired.add(guildId);
    }

    return player;
  }

  private wirePlayer(guildId: string, player: Player) {
    player.on('end', (data) => {
      // 'replaced' fires when we deliberately swap tracks (skip); 'stopped'
      // fires on an explicit stop. Neither should trigger auto-advance.
      if (data.reason === 'replaced' || data.reason === 'stopped') return;
      void this.advance(guildId);
    });

    player.on('exception', (data) => {
      logger.error({ guildId, data }, 'Lavalink player exception');
      void this.advance(guildId);
    });

    player.on('stuck', () => {
      logger.warn({ guildId }, 'Track stuck, advancing');
      void this.advance(guildId);
    });
  }

  /** Plays the next queued track, or schedules an idle disconnect if empty. */
  async advance(guildId: string): Promise<boolean> {
    const queue = this.queues.get(guildId);
    const player = shoukaku!.players.get(guildId);
    if (!queue || !player) return false;

    const next = queue.next();
    if (next) {
      await player.playTrack({ track: { encoded: next.encoded } });
      return true;
    }

    this.scheduleIdleDisconnect(guildId, queue.idleMinutes);
    return false;
  }

  private scheduleIdleDisconnect(guildId: string, idleMinutes: number) {
    setTimeout(
      () => {
        const current = shoukaku?.players.get(guildId);
        if (current && !current.track) void this.destroy(guildId);
      },
      idleMinutes * 60 * 1000,
    );
  }

  /** Stops playback, clears the queue and leaves the voice channel. */
  async destroy(guildId: string): Promise<void> {
    this.queues.get(guildId)?.clear();
    this.queues.delete(guildId);
    this.wired.delete(guildId);
    await shoukaku?.leaveVoiceChannel(guildId).catch(() => {});
  }

  async join(member: GuildMember, channel?: VoiceBasedChannel) {
    const voice = channel ?? member.voice.channel;
    if (!voice) throw new Error('You must be in a voice channel.');
    return this.ensurePlayer(voice);
  }

  async play(guildId: string, track: { encoded: string }) {
    const player = shoukaku!.players.get(guildId);
    if (!player) throw new Error('Not connected to voice.');
    await player.playTrack({ track: { encoded: track.encoded } });
  }

  async search(query: string) {
    const node = (shoukaku!.nodes.values().next().value as Node)!;
    const identifier = /^(https?:)?\/\//i.test(query) ? query : `ytsearch:${query}`;
    return search(node, identifier);
  }
}

export function initPlayerManager(client: Client) {
  return new PlayerManager(client);
}
