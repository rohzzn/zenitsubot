import type { GuildMember, VoiceBasedChannel } from 'discord.js';
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
import { Readable } from 'node:stream';
import { logger } from './logger.js';
import { askStream } from './ai.js';
import {
  DISCORD_SAMPLE_RATE,
  SentenceSplitter,
  synthesise,
  toDiscordPcm,
  transcribe,
} from './voice.js';

/**
 * One spoken conversation.
 *
 * Deliberately one-to-one. A voice channel has several people talking over
 * each other and no reliable way to know which sentences were meant for the
 * bot; restricting a session to the person who started it removes that problem
 * rather than guessing at it, and it is also the honest scope — the bot is
 * listening to one person who asked it to.
 */

/** Silence that ends a turn. Long enough to survive a pause mid-sentence. */
const TURN_END_MS = 700;
/** Nothing shorter than this is a sentence; it is a cough or a door. */
const MIN_UTTERANCE_MS = 400;
/** A turn cannot run forever; Discord's own stream would not stop either. */
const MAX_UTTERANCE_MS = 30_000;
/** Session ends itself if nobody says anything for this long. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = [
  'You are a voice assistant speaking aloud in a Discord voice call.',
  'Answer in one or two short sentences. Never use lists, markdown, headings or emoji.',
  'Write numbers and symbols as they are spoken. If you do not know, say so briefly.',
].join(' ');

export interface TalkEvents {
  onTranscript?: (text: string, ms: number) => void;
  onReply?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: (reason: string) => void;
}

export class TalkSession {
  private connection?: VoiceConnection;
  private player?: AudioPlayer;
  private idleTimer?: NodeJS.Timeout;
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private busy = false;
  private stopped = false;

  constructor(
    private readonly channel: VoiceBasedChannel,
    private readonly member: GuildMember,
    private readonly voice: string | undefined,
    private readonly events: TalkEvents = {},
  ) {}

  async start(): Promise<void> {
    this.connection = joinVoiceChannel({
      channelId: this.channel.id,
      guildId: this.channel.guild.id,
      adapterCreator: this.channel.guild.voiceAdapterCreator,
      // Both required: undeafened to receive, unmuted to speak.
      selfDeaf: false,
      selfMute: false,
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);

    this.player = createAudioPlayer();
    this.connection.subscribe(this.player);

    this.listen();
    this.resetIdle();

    logger.info({ guild: this.channel.guild.id, user: this.member.id }, 'Talk session started');
  }

  private listen(): void {
    const receiver = this.connection!.receiver;

    receiver.speaking.on('start', (userId) => {
      // Only the person who started the session. Everyone else in the channel
      // is having their own conversation and is not talking to the bot.
      if (userId !== this.member.id) return;
      // Ignoring speech while the bot is talking is what stops it hearing
      // itself and answering its own last sentence.
      if (this.busy || this.stopped) return;

      this.captureTurn(userId);
    });
  }

  private captureTurn(userId: string): void {
    const receiver = this.connection!.receiver;

    const opus = receiver.subscribe(userId, {
      // Discord sends nothing during silence, so a gap in packets is how a
      // turn ends. This is the whole turn-detection mechanism.
      end: { behavior: EndBehaviorType.AfterSilence, duration: TURN_END_MS },
    });

    const decoder = new prism.opus.Decoder({
      rate: DISCORD_SAMPLE_RATE,
      channels: 2,
      frameSize: 960,
    });

    const chunks: Buffer[] = [];
    let bytes = 0;

    const stream = opus.pipe(decoder);

    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      // Bounded so a stuck stream cannot grow without limit.
      if (bytes <= MAX_UTTERANCE_MS * (DISCORD_SAMPLE_RATE / 1000) * 4) chunks.push(chunk);
    });

    stream.on('end', () => {
      void this.handleTurn(Buffer.concat(chunks));
    });

    stream.on('error', (err) => {
      logger.debug({ err }, 'Voice receive stream failed');
    });
  }

  private async handleTurn(stereo: Buffer): Promise<void> {
    if (this.stopped || this.busy || stereo.length === 0) return;

    const durationMs = (stereo.length / 4 / DISCORD_SAMPLE_RATE) * 1000;
    if (durationMs < MIN_UTTERANCE_MS) return;

    this.busy = true;
    this.resetIdle();

    try {
      const text = (await transcribe(toMono(stereo))).text.trim();

      // Silence, breathing, or a model hallucinating punctuation onto nothing.
      if (text.length < 2) return;

      this.events.onTranscript?.(text, Math.round(durationMs));
      this.history.push({ role: 'user', content: text });

      await this.respond();
    } catch (err) {
      logger.warn({ err }, 'Talk turn failed');
      this.events.onError?.((err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Streams a reply and speaks it sentence by sentence.
   *
   * The first sentence is synthesised and played while the model is still
   * writing the rest, which is what makes the pause bearable — waiting for a
   * complete answer before speaking adds the model's entire generation time to
   * the silence.
   */
  private async respond(): Promise<void> {
    const splitter = new SentenceSplitter();
    const queue: string[] = [];
    let spoken = '';
    let speaking: Promise<void> = Promise.resolve();

    const speakNext = async (): Promise<void> => {
      const chunk = queue.shift();
      if (!chunk) return;

      const speech = await synthesise(chunk, this.voice);
      await this.play(toDiscordPcm(speech.pcm, speech.sampleRate));
    };

    await askStream(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...this.history.slice(-8)],
      (delta) => {
        for (const chunk of splitter.push(delta)) {
          queue.push(chunk);
          spoken += `${chunk} `;
          // Chained rather than parallel: the sentences have to come out in
          // order, and Discord has one audio player.
          speaking = speaking.then(speakNext).catch(() => {});
        }
      },
    );

    const tail = splitter.flush();
    if (tail) {
      queue.push(tail);
      spoken += tail;
      speaking = speaking.then(speakNext).catch(() => {});
    }

    await speaking;

    const reply = spoken.trim();
    if (reply) {
      this.history.push({ role: 'assistant', content: reply });
      this.events.onReply?.(reply);
    }
  }

  private play(pcm: Buffer): Promise<void> {
    return new Promise((resolve) => {
      const resource = createAudioResource(Readable.from(pcm), {
        // Raw PCM, so no ffmpeg is involved anywhere in this path — which
        // matters because it will not install on this host.
        inputType: StreamType.Raw,
      });

      this.player!.play(resource);

      const done = () => {
        this.player!.off(AudioPlayerStatus.Idle, done);
        resolve();
      };

      this.player!.on(AudioPlayerStatus.Idle, done);
      // A player that never reports idle must not wedge the conversation.
      setTimeout(done, 60_000).unref();
    });
  }

  private resetIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.stop('nobody said anything for a while'),
      IDLE_TIMEOUT_MS,
    );
    this.idleTimer.unref();
  }

  stop(reason = 'ended'): void {
    if (this.stopped) return;
    this.stopped = true;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.player?.stop(true);
    this.connection?.destroy();

    logger.info({ guild: this.channel.guild.id, reason }, 'Talk session ended');
    this.events.onEnd?.(reason);
  }

  get guildId(): string {
    return this.channel.guild.id;
  }
}

/**
 * Discord decodes to interleaved stereo; the model wants mono.
 *
 * Averaged rather than taking one channel, because a source panned to one side
 * would otherwise come through as silence.
 */
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

/** One session per guild; the voice connection cannot be shared. */
const sessions = new Map<string, TalkSession>();

export function activeSession(guildId: string): TalkSession | undefined {
  return sessions.get(guildId);
}

export function registerSession(session: TalkSession): void {
  sessions.set(session.guildId, session);
}

export function clearSession(guildId: string): void {
  sessions.delete(guildId);
}
