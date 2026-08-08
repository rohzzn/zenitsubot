import type { VoiceBasedChannel } from 'discord.js';
import {
  AudioPlayerStatus,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { PassThrough } from 'node:stream';
import { logger } from './logger.js';
import { getPrisma } from './db.js';
import { NARRATION_RATE, narrate, type NarratedChunk, type NarrationStyle } from './narration.js';
import type { Book, Chapter, Sentence } from './epub.js';
import { DISCORD_SAMPLE_RATE } from './voice.js';

/**
 * Playing a book.
 *
 * The design point is that narration is generated *while* it plays. A ten hour
 * book generated up front would be hours before a word was heard, so a small
 * queue runs ahead of the playhead and everything else follows from keeping it
 * fed: seeking clears it, changing voice clears it, running out of quota
 * changes what fills it.
 */

/** Paragraphs kept ready ahead of the one playing. */
const LOOKAHEAD = 3;
/** Position is written no more often than this; it changes constantly. */
const SAVE_INTERVAL_MS = 10_000;
/** Playback stops itself when left alone. */
const EMPTY_CHANNEL_MS = 60_000;

export interface TimedSentence extends Sentence {
  startMs: number;
  endMs: number;
}

export interface PlayerEvents {
  /** The sentence now being spoken, for the live transcript. */
  onSentence?: (sentence: TimedSentence, chapterIndex: number) => void;
  onChapter?: (chapter: Chapter) => void;
  onState?: () => void;
  /** Narration fell back to the local voice, with the reason. */
  onEngineChange?: (engine: 'gemini' | 'kokoro') => void;
  onFinished?: () => void;
  onError?: (message: string) => void;
}

interface QueuedChunk extends NarratedChunk {
  paragraphIndex: number;
  /** Milliseconds from the start of the chapter to the start of this chunk. */
  chapterOffsetMs: number;
}

export class AudiobookPlayer {
  private connection?: VoiceConnection;
  private player?: AudioPlayer;
  private stream?: PassThrough;

  private queue: QueuedChunk[] = [];
  private generating = false;
  /** Next paragraph to synthesise. */
  private cursor = 0;
  /** Paragraph currently being played. */
  private playingIndex = -1;

  private chapterIndex = 0;
  /** Milliseconds into the current chapter. */
  private positionMs = 0;
  private playedAt = 0;

  private paused = false;
  private stopped = false;
  private engine: 'gemini' | 'kokoro' = 'gemini';

  private saveTimer?: NodeJS.Timeout;
  private emptyTimer?: NodeJS.Timeout;
  private sentenceTimer?: NodeJS.Timeout;

  constructor(
    private readonly channel: VoiceBasedChannel,
    private readonly userId: string,
    readonly bookId: string,
    readonly book: Book,
    private settings: { voice: string; style: NarrationStyle; speed: number; volume: number },
    private readonly events: PlayerEvents = {},
  ) {}

  get chapter(): Chapter {
    return this.book.chapters[this.chapterIndex]!;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get currentEngine(): 'gemini' | 'kokoro' {
    return this.engine;
  }

  get position(): { chapter: number; ms: number } {
    return { chapter: this.chapterIndex, ms: this.livePositionMs() };
  }

  get options() {
    return { ...this.settings };
  }

  /** Position including time elapsed since the current chunk started playing. */
  private livePositionMs(): number {
    if (this.paused || !this.playedAt) return this.positionMs;
    return this.positionMs + (Date.now() - this.playedAt) * this.settings.speed;
  }

  async start(chapterIndex: number, offsetMs: number): Promise<void> {
    this.connection = joinVoiceChannel({
      channelId: this.channel.id,
      guildId: this.channel.guild.id,
      adapterCreator: this.channel.guild.voiceAdapterCreator,
      // Deafened: a narrator has no reason to listen, and it keeps the bot out
      // of anyone's recording.
      selfDeaf: true,
      selfMute: false,
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);

    this.player = createAudioPlayer();
    this.connection.subscribe(this.player);

    // Idle means a chunk finished. Advancing here rather than on a timer keeps
    // playback and position in step even when generation stalls.
    this.player.on(AudioPlayerStatus.Idle, () => void this.onChunkFinished());
    this.player.on('error', (err) => {
      logger.warn({ err: err.message }, 'Audiobook player error');
      void this.onChunkFinished();
    });

    await this.seek(chapterIndex, offsetMs);

    this.saveTimer = setInterval(() => void this.savePosition(), SAVE_INTERVAL_MS);
    this.saveTimer.unref();

    this.watchForEmpty();
  }

  /**
   * Jumps to a point in the book.
   *
   * Everything queued is thrown away: it is audio for a place we are no longer
   * going, and playing it after a seek is the single most disorienting thing a
   * player can do.
   */
  async seek(chapterIndex: number, offsetMs: number): Promise<void> {
    const clampedChapter = Math.min(Math.max(chapterIndex, 0), this.book.chapters.length - 1);
    const changed = clampedChapter !== this.chapterIndex;

    this.chapterIndex = clampedChapter;
    this.queue = [];
    this.playingIndex = -1;

    // Which paragraph contains that moment, by the same estimate used for the
    // progress bar until real durations are known.
    const chapter = this.chapter;
    const target = Math.max(0, offsetMs);

    let elapsed = 0;
    let paragraph = 0;
    for (let i = 0; i < chapter.paragraphs.length; i++) {
      const span = (chapter.paragraphs[i]!.text.length / 14.5) * 1000;
      if (elapsed + span > target) {
        paragraph = i;
        break;
      }
      elapsed += span;
      paragraph = i + 1;
    }

    this.cursor = Math.min(paragraph, chapter.paragraphs.length);
    this.positionMs = elapsed;
    this.playedAt = 0;

    this.player?.stop(true);
    this.stream?.destroy();
    this.stream = undefined;

    if (changed) this.events.onChapter?.(chapter);
    this.events.onState?.();

    void this.fill();
    this.playNext();
  }

  /** Keeps the lookahead topped up. One generation at a time. */
  private async fill(): Promise<void> {
    if (this.generating || this.stopped) return;
    this.generating = true;

    try {
      while (this.queue.length < LOOKAHEAD && !this.stopped) {
        const chapter = this.chapter;

        if (this.cursor >= chapter.paragraphs.length) {
          // Chapter exhausted: nothing more to generate until it advances.
          break;
        }

        const paragraph = chapter.paragraphs[this.cursor]!;
        const index = this.cursor;
        this.cursor++;

        // Offset of this paragraph is whatever the queue already covers.
        const offset =
          this.queue.length === 0
            ? this.positionMs
            : this.queue[this.queue.length - 1]!.chapterOffsetMs +
              this.queue[this.queue.length - 1]!.durationMs;

        const chunk = await narrate(paragraph, this.settings);

        if (chunk.engine !== this.engine) {
          this.engine = chunk.engine;
          this.events.onEngineChange?.(chunk.engine);
        }

        this.queue.push({ ...chunk, paragraphIndex: index, chapterOffsetMs: offset });

        // Nothing was playing while this generated, so start now.
        if (this.player?.state.status === AudioPlayerStatus.Idle && !this.paused) this.playNext();
      }
    } catch (err) {
      logger.warn({ err }, 'Narration generation failed');
      this.events.onError?.(`Could not narrate that passage: ${(err as Error).message}`);
    } finally {
      this.generating = false;
    }
  }

  private playNext(): void {
    if (this.stopped || this.paused) return;

    const chunk = this.queue.shift();
    if (!chunk) {
      // Underrun: generation has fallen behind. Waiting is better than
      // stuttering; fill() restarts playback when the next chunk lands.
      void this.fill();
      return;
    }

    this.playingIndex = chunk.paragraphIndex;
    this.positionMs = chunk.chapterOffsetMs;
    this.playedAt = Date.now();

    this.stream?.destroy();
    this.stream = new PassThrough();

    const resource = createAudioResource(this.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(this.settings.volume);

    this.player!.play(resource);
    this.stream.end(toDiscordStereo(chunk.pcm, NARRATION_RATE, this.settings.speed));

    this.scheduleSentences(chunk);
    void this.fill();
  }

  /**
   * Fires the transcript highlight as each sentence comes round.
   *
   * Timer-driven rather than polled: the sentence boundaries are known when
   * the chunk is generated, so the highlight can land on the sentence instead
   * of near it.
   */
  private scheduleSentences(chunk: QueuedChunk): void {
    if (this.sentenceTimer) clearTimeout(this.sentenceTimer);

    const queue = [...chunk.sentences];
    const startedAt = Date.now();

    const next = () => {
      if (this.stopped || this.paused) return;

      const sentence = queue.shift();
      if (!sentence) return;

      this.events.onSentence?.(sentence, this.chapterIndex);

      const upcoming = queue[0];
      if (!upcoming) return;

      const due = upcoming.startMs / this.settings.speed - (Date.now() - startedAt);
      this.sentenceTimer = setTimeout(next, Math.max(0, due));
      this.sentenceTimer.unref();
    };

    next();
  }

  private async onChunkFinished(): Promise<void> {
    if (this.stopped || this.paused) return;

    const chapter = this.chapter;
    const wasLast = this.playingIndex >= chapter.paragraphs.length - 1 && this.queue.length === 0;

    if (wasLast) {
      if (this.chapterIndex >= this.book.chapters.length - 1) {
        await this.markFinished();
        this.events.onFinished?.();
        return;
      }

      await this.seek(this.chapterIndex + 1, 0);
      return;
    }

    this.playNext();
  }

  pause(): void {
    if (this.paused) return;

    // Position frozen before the flag flips, or the elapsed time is lost.
    this.positionMs = this.livePositionMs();
    this.paused = true;
    this.playedAt = 0;

    if (this.sentenceTimer) clearTimeout(this.sentenceTimer);
    this.player?.pause(true);
    this.events.onState?.();
    void this.savePosition();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;

    // The player only resumes if it still holds a resource; after a long pause
    // it may have gone idle, in which case the chunk is replayed from here.
    if (!this.player?.unpause()) {
      void this.seek(this.chapterIndex, this.positionMs);
    } else {
      this.playedAt = Date.now();
    }

    this.events.onState?.();
  }

  async skip(seconds: number): Promise<void> {
    await this.seek(this.chapterIndex, this.livePositionMs() + seconds * 1000);
  }

  async goToChapter(index: number): Promise<void> {
    await this.seek(index, 0);
  }

  async setVoice(voice: string, style: NarrationStyle): Promise<void> {
    this.settings = { ...this.settings, voice, style };
    // Regenerated from here: queued audio is in the old voice, and switching
    // mid-paragraph would be jarring.
    await this.seek(this.chapterIndex, this.livePositionMs());
  }

  async setSpeed(speed: number): Promise<void> {
    this.settings = { ...this.settings, speed };
    await this.seek(this.chapterIndex, this.livePositionMs());
  }

  setVolume(volume: number): void {
    this.settings = { ...this.settings, volume };
    this.events.onState?.();
  }

  /** The sentence being spoken right now, for bookmarking. */
  currentSentence(): Sentence | undefined {
    const chapter = this.chapter;
    const paragraph = chapter.paragraphs[Math.max(0, this.playingIndex)];
    return paragraph?.sentences[0];
  }

  private async savePosition(): Promise<void> {
    if (this.stopped) return;

    await getPrisma()
      .audiobookPosition.upsert({
        where: { bookId_userId: { bookId: this.bookId, userId: this.userId } },
        create: {
          bookId: this.bookId,
          userId: this.userId,
          chapter: this.chapterIndex,
          offset: this.livePositionMs() / 1000,
          voice: this.settings.voice,
          style: this.settings.style,
          speed: this.settings.speed,
        },
        update: {
          chapter: this.chapterIndex,
          offset: this.livePositionMs() / 1000,
          voice: this.settings.voice,
          style: this.settings.style,
          speed: this.settings.speed,
        },
      })
      .catch((err) => logger.debug({ err }, 'Could not save audiobook position'));
  }

  private async markFinished(): Promise<void> {
    await getPrisma()
      .audiobookPosition.updateMany({
        where: { bookId: this.bookId, userId: this.userId },
        data: { finished: true },
      })
      .catch(() => {});
  }

  private watchForEmpty(): void {
    let empty = 0;

    this.emptyTimer = setInterval(() => {
      const humans = this.channel.guild.voiceStates.cache.filter(
        (state) => state.channelId === this.channel.id && !state.member?.user.bot,
      ).size;

      if (humans > 0) {
        empty = 0;
        return;
      }

      // Two readings, because a momentarily cold cache should not end a book.
      if (++empty >= 2) void this.stop('everyone left');
    }, EMPTY_CHANNEL_MS);

    this.emptyTimer.unref();
  }

  async stop(reason = 'stopped'): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    await this.savePosition();

    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.emptyTimer) clearInterval(this.emptyTimer);
    if (this.sentenceTimer) clearTimeout(this.sentenceTimer);

    this.queue = [];
    this.stream?.destroy();
    this.player?.stop(true);

    try {
      if (this.connection?.state.status !== VoiceConnectionStatus.Destroyed) {
        this.connection?.destroy();
      }
    } catch (err) {
      logger.debug({ err }, 'Voice connection already gone');
    }

    logger.info({ guild: this.channel.guild.id, reason }, 'Audiobook stopped');
    this.events.onState?.();
  }

  get guildId(): string {
    return this.channel.guild.id;
  }

  get channelName(): string {
    return this.channel.name;
  }
}

/**
 * Mono narration to Discord's 48kHz interleaved stereo, with speed applied.
 *
 * Speed is a resample, which shifts pitch slightly — at the 0.75x to 2x range
 * offered here that reads as a faster or slower reader rather than a chipmunk,
 * and it avoids regenerating audio every time somebody nudges the speed.
 */
function toDiscordStereo(pcm: Buffer, sourceRate: number, speed: number): Buffer {
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const ratio = DISCORD_SAMPLE_RATE / (sourceRate * speed);
  const frames = Math.floor(input.length * ratio);

  const out = Buffer.allocUnsafe(frames * 4);

  for (let i = 0; i < frames; i++) {
    const position = i / ratio;
    const index = Math.floor(position);
    const fraction = position - index;

    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    const value = Math.round(a + (b - a) * fraction);

    out.writeInt16LE(value, i * 4);
    out.writeInt16LE(value, i * 4 + 2);
  }

  return out;
}

const players = new Map<string, AudiobookPlayer>();

export function activePlayer(guildId: string): AudiobookPlayer | undefined {
  return players.get(guildId);
}

export function registerPlayer(player: AudiobookPlayer): void {
  players.set(player.guildId, player);
}

export function clearPlayer(guildId: string): void {
  players.delete(guildId);
}
