import type { Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import {
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import prism from 'prism-media';
import { PassThrough } from 'node:stream';
import { logger } from './logger.js';
import { GeminiLiveSession, GEMINI_INPUT_RATE, GEMINI_OUTPUT_RATE } from './geminiLive.js';
import { checkForWakeWord, isFollowUp } from './wakeWord.js';
import { describeSpeaker, ensureProfile, loadMemory, recordExchange } from './voiceMemory.js';
import { DISCORD_SAMPLE_RATE } from './voice.js';

/**
 * Zenitsu sitting in a voice channel.
 *
 * The shape of this is decided by one requirement: a channel with ten people
 * in it is mostly conversation that has nothing to do with the bot, and none
 * of it should be sent anywhere. So there are two stages.
 *
 * Everything anyone says is transcribed locally, on the Parakeet server, at
 * roughly 40ms an utterance. Only an utterance containing "Zenitsu" opens a
 * live session and gets forwarded. Ordinary conversation never leaves the
 * machine and never costs quota.
 *
 * Once someone has addressed it, their microphone streams straight through to
 * Gemini until the exchange goes quiet — including while Zenitsu is talking,
 * which is what makes interrupting it work.
 */

/** Silence that ends an utterance, for the local wake-word pass. */
const UTTERANCE_END_MS = 600;
/** Below this an utterance is a cough, not a sentence. */
const MIN_UTTERANCE_MS = 350;
/** Cap on a single captured utterance. */
const MAX_UTTERANCE_MS = 30_000;
/** Live session closes after this long with nobody addressing it. */
const SESSION_IDLE_MS = 90_000;
/** Whole thing gives up after this long alone in a channel. */
const EMPTY_CHANNEL_MS = 60_000;

export interface ZenitsuEvents {
  onHeard?: (name: string, text: string, addressed: boolean) => void;
  onReply?: (text: string) => void;
  onTool?: (name: string, detail: string) => void;
  onState?: (state: string) => void;
  onError?: (message: string) => void;
}

export class ZenitsuVoice {
  private connection?: VoiceConnection;
  private player?: AudioPlayer;
  private live?: GeminiLiveSession;

  /** Users currently streaming straight to Gemini. */
  private streaming = new Set<string>();
  /** Users whose utterance is being captured for the local wake check. */
  private capturing = new Set<string>();

  private playback?: PassThrough;
  private idleTimer?: NodeJS.Timeout;
  private emptyTimer?: NodeJS.Timeout;

  private lastSpeakerId?: string;
  private lastRepliedAt?: number;
  private stopped = false;

  constructor(
    private readonly channel: VoiceBasedChannel,
    private readonly events: ZenitsuEvents = {},
  ) {}

  async join(): Promise<void> {
    this.connection = joinVoiceChannel({
      channelId: this.channel.id,
      guildId: this.channel.guild.id,
      adapterCreator: this.channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);

    this.player = createAudioPlayer();
    this.connection.subscribe(this.player);

    this.connection.receiver.speaking.on('start', (userId) => void this.onSpeaking(userId));

    this.watchForEmpty();
    this.events.onState?.('listening');

    logger.info({ guild: this.channel.guild.id, channel: this.channel.id }, 'Zenitsu joined');
  }

  private async onSpeaking(userId: string): Promise<void> {
    if (this.stopped) return;
    // Never listen to itself, which would be a feedback loop.
    if (userId === this.channel.client.user?.id) return;

    // Already piping this person to Gemini: nothing to decide, the live
    // session is handling their turn taking.
    if (this.streaming.has(userId)) return;
    if (this.capturing.has(userId)) return;

    await this.captureForWakeCheck(userId);
  }

  /**
   * Captures one utterance and decides locally whether it was for us.
   *
   * The whole utterance is taken rather than a rolling window: with ten people
   * a per-speaker window means continuous inference on every stream, and the
   * request is the rest of the same sentence as the wake word anyway.
   */
  private async captureForWakeCheck(userId: string): Promise<void> {
    this.capturing.add(userId);

    const opus = this.connection!.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: UTTERANCE_END_MS },
    });

    const decoder = new prism.opus.Decoder({
      rate: DISCORD_SAMPLE_RATE,
      channels: 2,
      frameSize: 960,
    });

    const chunks: Buffer[] = [];
    let bytes = 0;
    const cap = MAX_UTTERANCE_MS * (DISCORD_SAMPLE_RATE / 1000) * 4;

    const stream = opus.pipe(decoder);
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= cap) chunks.push(chunk);
    });

    stream.on('error', () => this.capturing.delete(userId));

    stream.on('end', () => {
      this.capturing.delete(userId);
      void this.decide(userId, Buffer.concat(chunks));
    });
  }

  private async decide(userId: string, stereo: Buffer): Promise<void> {
    if (this.stopped || stereo.length === 0) return;

    const durationMs = (stereo.length / 4 / DISCORD_SAMPLE_RATE) * 1000;
    if (durationMs < MIN_UTTERANCE_MS) return;

    const mono = toMono(stereo);
    const check = await checkForWakeWord(mono, DISCORD_SAMPLE_RATE);
    if (!check.heard) return;

    const member = await this.channel.guild.members.fetch(userId).catch(() => null);
    const name = member?.displayName ?? 'Someone';

    // A follow-up counts: requiring the name in every sentence turns a
    // conversation into a command line.
    const continuing = isFollowUp(this.lastRepliedAt, userId, this.lastSpeakerId);
    const addressed = check.woken || continuing;

    this.events.onHeard?.(name, check.heard, addressed);

    if (!addressed) return;

    // The request is what followed the wake word; on a follow-up the whole
    // sentence is the request.
    const request = check.woken ? check.request : check.heard;

    await this.engage(userId, name, request, mono, member ?? undefined);
  }

  /**
   * Hands this speaker to Gemini and keeps their microphone flowing.
   */
  private async engage(
    userId: string,
    name: string,
    request: string,
    utterance: Buffer,
    member?: GuildMember,
  ): Promise<void> {
    try {
      await this.ensureLive();
    } catch (err) {
      this.events.onError?.((err as Error).message);
      return;
    }

    await ensureProfile(userId, member?.displayName ?? name);
    const memory = await loadMemory(userId, name);

    this.lastSpeakerId = userId;
    this.live!.announceSpeaker(name, describeSpeaker(memory));

    // The utterance that woke us, replayed first — it contains the question,
    // and asking someone to repeat themselves after a wake word is the exact
    // interaction this design exists to avoid.
    this.live!.sendAudio(resampleMono(utterance, DISCORD_SAMPLE_RATE, GEMINI_INPUT_RATE), userId);

    void recordExchange(userId, request || check(request), undefined, this.channel.guild.id);

    this.streamUser(userId);
    this.resetIdle();
    this.events.onState?.('talking');
  }

  /**
   * Pipes one user's microphone continuously into the live session.
   *
   * Unbroken by design, including while Zenitsu is speaking. Gemini's own
   * turn detection needs to hear the interruption to act on it, so gating the
   * microphone during playback would break barge-in entirely.
   */
  private streamUser(userId: string): void {
    if (this.streaming.has(userId)) return;
    this.streaming.add(userId);

    const opus = this.connection!.receiver.subscribe(userId, {
      // Long silence, because the live session decides turns. This only ends
      // when the person has genuinely stopped taking part.
      end: { behavior: EndBehaviorType.AfterSilence, duration: 3_000 },
    });

    const decoder = new prism.opus.Decoder({
      rate: DISCORD_SAMPLE_RATE,
      channels: 2,
      frameSize: 960,
    });

    const stream = opus.pipe(decoder);

    stream.on('data', (chunk: Buffer) => {
      if (this.stopped || !this.live?.isOpen) return;
      this.live.sendAudio(
        resampleMono(toMono(chunk), DISCORD_SAMPLE_RATE, GEMINI_INPUT_RATE),
        userId,
      );
    });

    const finish = () => {
      this.streaming.delete(userId);
      // Discord's stream ending *is* the silence. Gemini's turn detection
      // never sees a pause otherwise, because no packets are sent during one.
      this.live?.endTurn();
      stream.removeAllListeners();
    };

    stream.on('end', finish);
    stream.on('error', finish);
  }

  private async ensureLive(): Promise<void> {
    if (this.live?.isOpen) return;

    const context = [
      `You are in the "${this.channel.name}" voice channel of the "${this.channel.guild.name}" Discord server.`,
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
    ].join('\n');

    this.live = new GeminiLiveSession({
      onAudio: (pcm) => this.speak(pcm),
      onInterrupted: () => this.stopSpeaking(),
      onTurnComplete: () => {
        this.lastRepliedAt = Date.now();
        this.events.onState?.('listening');
      },
      onText: (text) => {
        this.events.onReply?.(text);
        if (this.lastSpeakerId) {
          void recordExchange(this.lastSpeakerId, '', text, this.channel.guild.id);
        }
      },
      onTool: (name, detail) => this.events.onTool?.(name, detail),
      onError: (message) => this.events.onError?.(message),
      onClose: () => {
        this.live = undefined;
        this.streaming.clear();
      },
    });

    await this.live.open(context);
  }

  /**
   * Plays the model's speech as it arrives.
   *
   * One long-lived stream rather than a resource per chunk: creating a new
   * audio resource for every packet produces an audible gap at each seam, and
   * the model sends speech in fragments far shorter than a sentence.
   */
  private speak(pcm24k: Buffer): void {
    if (this.stopped) return;

    if (!this.playback) {
      this.playback = new PassThrough();

      const resource = createAudioResource(this.playback, {
        // Raw, so nothing shells out to ffmpeg — which is not installed.
        inputType: StreamType.Raw,
      });

      this.player!.play(resource);
    }

    this.playback.write(resampleToDiscord(pcm24k, GEMINI_OUTPUT_RATE));
  }

  /**
   * Cuts playback dead.
   *
   * Everything buffered is discarded rather than drained: the person has
   * started talking, and finishing the sentence would be Zenitsu talking over
   * them, which is the opposite of what interrupting should do.
   */
  private stopSpeaking(): void {
    this.playback?.destroy();
    this.playback = undefined;
    this.player?.stop(true);
    this.events.onState?.('listening');
  }

  private resetIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(() => {
      // The websocket closes but the bot stays in the channel: it is still a
      // participant, just not holding a session open against a quota while
      // nobody is talking to it.
      this.live?.close();
      this.live = undefined;
      this.streaming.clear();
      this.events.onState?.('listening');
    }, SESSION_IDLE_MS);

    this.idleTimer.unref();
  }

  /** Leaves once the humans have. */
  private watchForEmpty(): void {
    this.emptyTimer = setInterval(() => {
      const humans = this.channel.members.filter((m) => !m.user.bot).size;
      if (humans === 0) this.leave('everyone left');
    }, EMPTY_CHANNEL_MS);

    this.emptyTimer.unref();
  }

  leave(reason = 'stopped'): void {
    if (this.stopped) return;
    this.stopped = true;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.emptyTimer) clearInterval(this.emptyTimer);

    this.live?.close();
    this.playback?.destroy();
    this.player?.stop(true);
    this.connection?.destroy();

    logger.info({ guild: this.channel.guild.id, reason }, 'Zenitsu left');
    this.events.onState?.(`left: ${reason}`);
  }

  get guildId(): string {
    return this.channel.guild.id;
  }

  get channelName(): string {
    return this.channel.name;
  }
}

/** Placeholder for an utterance whose text we did not keep. */
function check(request: string): string {
  return request || '(spoken)';
}

/** Interleaved stereo to mono, averaged so a panned source is not lost. */
function toMono(stereo: Buffer): Buffer {
  const frames = Math.floor(stereo.length / 4);
  const mono = Buffer.allocUnsafe(frames * 2);

  for (let i = 0; i < frames; i++) {
    const left = stereo.readInt16LE(i * 4);
    const right = stereo.readInt16LE(i * 4 + 2);
    mono.writeInt16LE((left + right) >> 1, i * 2);
  }

  return mono;
}

/** Mono PCM16 between two rates, linearly. Speech does not need better. */
function resampleMono(pcm: Buffer, from: number, to: number): Buffer {
  if (from === to) return pcm;

  const input = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const outputLength = Math.floor(input.length * (to / from));
  const out = Buffer.allocUnsafe(outputLength * 2);

  for (let i = 0; i < outputLength; i++) {
    const position = (i * from) / to;
    const index = Math.floor(position);
    const fraction = position - index;

    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    out.writeInt16LE(Math.round(a + (b - a) * fraction), i * 2);
  }

  return out;
}

/** Mono at the model's rate to Discord's interleaved 48kHz stereo. */
function resampleToDiscord(pcm: Buffer, from: number): Buffer {
  const mono = resampleMono(pcm, from, DISCORD_SAMPLE_RATE);
  const samples = new Int16Array(mono.buffer, mono.byteOffset, Math.floor(mono.length / 2));
  const out = Buffer.allocUnsafe(samples.length * 4);

  for (let i = 0; i < samples.length; i++) {
    out.writeInt16LE(samples[i]!, i * 4);
    out.writeInt16LE(samples[i]!, i * 4 + 2);
  }

  return out;
}

const sessions = new Map<string, ZenitsuVoice>();

export function activeZenitsu(guildId: string): ZenitsuVoice | undefined {
  return sessions.get(guildId);
}

export function registerZenitsu(session: ZenitsuVoice): void {
  sessions.set(session.guildId, session);
}

export function clearZenitsu(guildId: string): void {
  sessions.delete(guildId);
}

export function zenitsuGuilds(): Guild[] {
  return [];
}
