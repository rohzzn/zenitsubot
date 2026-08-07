import type { VoiceBasedChannel } from 'discord.js';
import type { Track } from './track.js';

export class GuildQueue {
  public readonly guildId: string;
  public readonly channelId: string;
  private tracks: Track[] = [];
  private currentIndex = -1;
  public loop: 'off' | 'track' | 'queue' = 'off';
  public defaultVolume = 0.5; // 0..1
  public idleMinutes = 5;

  constructor(opts: {
    guildId: string;
    channelId: string;
    defaultVolume?: number;
    idleMinutes?: number;
  }) {
    this.guildId = opts.guildId;
    this.channelId = opts.channelId;
    if (typeof opts.defaultVolume === 'number') this.defaultVolume = opts.defaultVolume;
    if (typeof opts.idleMinutes === 'number') this.idleMinutes = opts.idleMinutes;
  }

  enqueue(track: Track) {
    this.tracks.push(track);
  }

  enqueueMany(items: Track[]) {
    this.tracks.push(...items);
  }

  next(): Track | null {
    if (this.tracks.length === 0) return null;
    if (this.loop === 'track' && this.currentIndex >= 0)
      return this.tracks[this.currentIndex] ?? null;

    if (this.currentIndex + 1 < this.tracks.length) {
      this.currentIndex += 1;
      return this.tracks[this.currentIndex] ?? null;
    }
    if (this.loop === 'queue') {
      this.currentIndex = 0;
      return this.tracks[0] ?? null;
    }
    return null;
  }

  now(): Track | null {
    if (this.currentIndex < 0) return null;
    return this.tracks[this.currentIndex] ?? null;
  }

  remove(index: number): Track | null {
    if (index < 0 || index >= this.tracks.length) return null;
    const [removed] = this.tracks.splice(index, 1);
    if (index <= this.currentIndex) this.currentIndex -= 1;
    return removed ?? null;
  }

  skip(count = 1): Track | null {
    this.currentIndex += count;
    if (this.currentIndex >= this.tracks.length) {
      if (this.loop === 'queue' && this.tracks.length > 0) {
        this.currentIndex = this.currentIndex % this.tracks.length;
        return this.tracks[this.currentIndex] ?? null;
      }
      return null;
    }
    return this.tracks[this.currentIndex] ?? null;
  }

  shuffle() {
    const current = this.now();
    const rest = this.tracks.filter((_, i) => i !== this.currentIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = rest[i];
      rest[i] = rest[j]!;
      rest[j] = temp!;
    }
    this.tracks = current ? [current, ...rest] : rest;
    this.currentIndex = current ? 0 : -1;
  }

  clear() {
    this.tracks = [];
    this.currentIndex = -1;
  }

  list(): Track[] {
    return [...this.tracks];
  }

  /** Index of the playing track within list(), or -1 when nothing is playing. */
  position(): number {
    return this.currentIndex;
  }
}
