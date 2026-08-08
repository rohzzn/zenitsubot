import { UpstreamError, UserError } from '../utils/errors.js';
import { logger } from './logger.js';

/**
 * The bot's half of the speech pipeline.
 *
 * The models themselves run on the Mac, outside Docker, because Docker Desktop
 * on macOS exposes no Metal GPU to containers — a containerised Parakeet or
 * Kokoro runs CPU-only and throws away most of the machine. This module is a
 * thin HTTP client onto that host process.
 *
 * Latency measured on the M2 this was built for, once warm:
 *
 *   speech -> text     ~130-270ms
 *   first token        ~1000ms   (ling-3.0-tiny:free)
 *   first spoken word  ~600ms    (Kokoro + CoreML)
 *
 * which puts the first sound roughly 2 seconds after someone stops talking.
 */

const VOICE_URL = process.env.VOICE_SERVICE_URL ?? 'http://host.docker.internal:8931';

/**
 * Generous, because a genuinely cold model can take twenty seconds and
 * timing out there produced a "the models are not running" message about a
 * server that was running perfectly well.
 */
const STT_TIMEOUT_MS = 45_000;
const TTS_TIMEOUT_MS = 30_000;

/** Discord decodes Opus to this; the server resamples for the model. */
export const DISCORD_SAMPLE_RATE = 48_000;

export interface Transcript {
  text: string;
  /** Seconds of audio submitted. */
  seconds: number;
  /** Milliseconds the model took. */
  ms: number;
}

export interface Speech {
  pcm: Buffer;
  sampleRate: number;
  durationMs: number;
  generateMs: number;
}

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${VOICE_URL}${path}`, { ...init, signal: controller.signal });

    if (!response.ok) {
      throw new UpstreamError('The voice service', `Voice service returned ${response.status}.`);
    }
    return response;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;

    // An abort is a slow model, not an absent one. Reporting "not running"
    // for a timeout sent me looking at a server that was fine.
    if ((err as Error)?.name === 'AbortError' || (err as Error)?.name === 'TimeoutError') {
      throw new UpstreamError('The voice service', 'The speech models took too long to answer.');
    }

    // Otherwise the likeliest failure really is the host process not running,
    // and "fetch failed" tells nobody how to fix that.
    throw new UpstreamError(
      'The voice service',
      'The speech models are not running. Start them with `npm run voice` on the host.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function isVoiceServiceUp(): Promise<boolean> {
  try {
    const response = await call('/health', { method: 'GET' }, 3_000);
    return Boolean(((await response.json()) as { ok?: boolean }).ok);
  } catch {
    return false;
  }
}

/** Signed 16-bit mono PCM in, text out. */
export async function transcribe(
  pcm: Buffer,
  sampleRate = DISCORD_SAMPLE_RATE,
): Promise<Transcript> {
  const response = await call(
    `/stt?rate=${sampleRate}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(pcm),
    },
    STT_TIMEOUT_MS,
  );

  return (await response.json()) as Transcript;
}

/** Text in, signed 16-bit mono PCM out at the server's own rate. */
export async function synthesise(text: string, voice?: string): Promise<Speech> {
  const trimmed = text.trim();
  if (!trimmed) throw new UserError('Nothing to say.');

  const response = await call(
    '/tts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed.slice(0, 800), voice }),
    },
    TTS_TIMEOUT_MS,
  );

  return {
    pcm: Buffer.from(await response.arrayBuffer()),
    sampleRate: Number(response.headers.get('x-sample-rate') ?? 24_000),
    durationMs: Number(response.headers.get('x-duration-ms') ?? 0),
    generateMs: Number(response.headers.get('x-generate-ms') ?? 0),
  };
}

/**
 * Warms the models before a session starts.
 *
 * Metal discards compiled kernels when idle, and the first request after that
 * took 21 seconds against a warm 2. Paying it while the bot is still joining
 * the channel means the first actual question does not.
 */
export async function warmUp(): Promise<number> {
  try {
    const response = await call('/warm', { method: 'POST' }, 120_000);
    return ((await response.json()) as { ms: number }).ms;
  } catch {
    // A failed warm is not a reason to refuse the session; it just means the
    // first answer is slow.
    return 0;
  }
}

export async function listVoices(): Promise<string[]> {
  try {
    const response = await call('/voices', { method: 'GET' }, 5_000);
    return ((await response.json()) as { voices: string[] }).voices;
  } catch {
    return [];
  }
}

/**
 * Resamples PCM to Discord's rate, and mono to stereo.
 *
 * Kokoro produces 24kHz mono; Discord wants 48kHz stereo. Linear interpolation
 * is more than enough for speech and keeps ffmpeg — which will not install on
 * this host — out of the path.
 */
export function toDiscordPcm(pcm: Buffer, sourceRate: number): Buffer {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const ratio = DISCORD_SAMPLE_RATE / sourceRate;
  const outputLength = Math.floor(samples.length * ratio);

  // Two channels, two bytes each.
  const out = Buffer.allocUnsafe(outputLength * 4);

  for (let i = 0; i < outputLength; i++) {
    const position = i / ratio;
    const index = Math.floor(position);
    const fraction = position - index;

    const a = samples[index] ?? 0;
    const b = samples[index + 1] ?? a;
    const value = Math.round(a + (b - a) * fraction);

    // Same sample to both channels: the source is mono and Discord expects
    // interleaved stereo.
    out.writeInt16LE(value, i * 4);
    out.writeInt16LE(value, i * 4 + 2);
  }

  return out;
}

/**
 * Splits streamed text into speakable chunks as it arrives.
 *
 * This is the single biggest win available on perceived latency: speaking the
 * first sentence while the model is still writing the second turns a four
 * second wait into a one and a half second wait followed by talking.
 *
 * Chunks are emitted on sentence punctuation, or once a clause grows long
 * enough that waiting for a full stop would stall — some models produce very
 * long sentences, and a comma is a natural enough place to breathe.
 */
export class SentenceSplitter {
  private buffer = '';

  push(delta: string): string[] {
    this.buffer += stripReasoning(delta);
    const ready: string[] = [];

    for (;;) {
      const chunk = this.take();
      if (!chunk) break;
      ready.push(chunk);
    }

    return ready;
  }

  /** Whatever is left when the stream ends. */
  flush(): string | null {
    const rest = stripReasoning(this.buffer).trim();
    this.buffer = '';
    return rest || null;
  }

  private take(): string | null {
    // A decimal point or an abbreviation is not the end of a sentence, so the
    // break has to be followed by whitespace or the end of what we have.
    const sentence = this.buffer.match(/^(.*?[.!?])(\s|$)/s);
    if (sentence?.[1] && sentence[1].trim().length >= MIN_CHUNK) {
      this.buffer = this.buffer.slice(sentence[0].length);
      return sentence[1].trim();
    }

    if (this.buffer.length >= MAX_CHUNK) {
      // Long clause: break at the last comma, or failing that the last space,
      // so the split lands somewhere a person would pause.
      const window = this.buffer.slice(0, MAX_CHUNK);
      const at = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' — '));
      const cut = at > MIN_CHUNK ? at + 1 : window.lastIndexOf(' ');

      if (cut > MIN_CHUNK) {
        const chunk = this.buffer.slice(0, cut).trim();
        this.buffer = this.buffer.slice(cut);
        return chunk;
      }
    }

    return null;
  }
}

/**
 * Removes a model's own thinking from what gets spoken.
 *
 * Several models emit reasoning as ordinary content rather than a separate
 * field, and ling-3.0-tiny closed a turn with a literal `</think>` mid-answer —
 * which was duly read aloud, along with the sentence repeated on either side
 * of it. Anything inside the tags goes, and so do stray tags with no partner,
 * since a stream can be cut anywhere.
 */
function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think(?:ing)?>/gi, '')
    .replace(/<\|[^|]*\|>/g, '');
}

/** Too short to be worth a separate synthesis round trip. */
const MIN_CHUNK = 12;
/** Past this, waiting for punctuation costs more than an awkward break. */
const MAX_CHUNK = 180;

export function voiceServiceUrl(): string {
  return VOICE_URL;
}

logger.debug({ url: VOICE_URL }, 'Voice service configured');
