import { GoogleGenAI } from '@google/genai';
import { logger } from './logger.js';
import { RateLimitError, UpstreamError } from '../utils/errors.js';
import { synthesise as kokoro } from './voice.js';
import type { Paragraph, Sentence } from './epub.js';

/**
 * Turning a chapter into speech.
 *
 * Two engines, and the fallback is not decoration. Gemini's TTS is free but
 * rate limited by requests per day, and a novel is roughly nine hundred
 * paragraphs — enough that a long session can run the quota out mid-chapter.
 * When that happens the book keeps playing in the local voice rather than
 * stopping, and the player says why.
 *
 * Nothing is generated far ahead. A ten hour book generated up front would
 * take hours before a word was heard; generating a paragraph or two ahead of
 * the playhead means narration starts in seconds and nothing is wasted on a
 * book someone abandons after a page.
 */

const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-3.1-flash-tts-preview';

/** Gemini returns 24kHz mono PCM16, same as Kokoro. */
export const NARRATION_RATE = 24_000;

/**
 * Voices, with the ones people reach for first at the top.
 *
 * Gemini's names are opaque, so each carries a description — "Kore" tells you
 * nothing about whether it suits a thriller.
 */
export const NARRATOR_VOICES = [
  {
    id: 'Kore',
    label: 'Kore',
    blurb: 'Warm and even. A good default for fiction.',
    gender: 'female',
  },
  {
    id: 'Charon',
    label: 'Charon',
    blurb: 'Low and measured. Suits history and non-fiction.',
    gender: 'male',
  },
  { id: 'Puck', label: 'Puck', blurb: 'Bright and quick. Good for comedy and YA.', gender: 'male' },
  {
    id: 'Aoede',
    label: 'Aoede',
    blurb: 'Soft and unhurried. Easy to fall asleep to.',
    gender: 'female',
  },
  { id: 'Fenrir', label: 'Fenrir', blurb: 'Gravelly. Suits horror and noir.', gender: 'male' },
  { id: 'Leda', label: 'Leda', blurb: 'Clear and youthful.', gender: 'female' },
  { id: 'Orus', label: 'Orus', blurb: 'Firm and formal.', gender: 'male' },
  { id: 'Zephyr', label: 'Zephyr', blurb: 'Light and airy.', gender: 'female' },
] as const;

/**
 * Narration styles, expressed as direction rather than as a setting.
 *
 * The TTS model takes a natural-language instruction before the text, so a
 * style is literally what you would tell a narrator in a booth.
 */
export const NARRATION_STYLES = [
  {
    id: 'natural',
    label: 'Natural',
    blurb: 'Plain, unhurried reading',
    direction: 'Read this aloud naturally, at an even audiobook pace.',
  },
  {
    id: 'calm',
    label: 'Calm',
    blurb: 'Quiet and slow, for winding down',
    direction:
      'Read this softly and slowly, in a calm, soothing voice, as if reading someone to sleep.',
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    blurb: 'Weighted pauses and emphasis',
    direction:
      'Read this dramatically, with weight and deliberate pauses. Let tension build. Emphasise what matters.',
  },
  {
    id: 'storyteller',
    label: 'Storyteller',
    blurb: 'Warm, like being read to',
    direction:
      'Read this like a storyteller with an audience in front of you: warm, expressive, taking your time.',
  },
  {
    id: 'energetic',
    label: 'Energetic',
    blurb: 'Brisk and lively',
    direction: 'Read this with energy and pace, lively and engaged, keeping things moving.',
  },
] as const;

export type NarrationStyle = (typeof NARRATION_STYLES)[number]['id'];

export function styleById(id: string) {
  return NARRATION_STYLES.find((s) => s.id === id) ?? NARRATION_STYLES[0];
}

export function voiceById(id: string) {
  return NARRATOR_VOICES.find((v) => v.id === id) ?? NARRATOR_VOICES[0];
}

export interface NarratedChunk {
  /** PCM16 mono at NARRATION_RATE. */
  pcm: Buffer;
  durationMs: number;
  /** Which engine produced it, so the player can say when it fell back. */
  engine: 'gemini' | 'kokoro';
  /** The sentences in this chunk, with timings once aligned. */
  sentences: Array<Sentence & { startMs: number; endMs: number }>;
}

let client: GoogleGenAI | undefined;

function gemini(): GoogleGenAI | undefined {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return undefined;

  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * When the daily quota ran out.
 *
 * Remembered rather than rediscovered: once Gemini has refused for quota, every
 * subsequent paragraph would refuse too, and asking anyway adds a failed round
 * trip to every chunk. Cleared after an hour in case the window rolled over.
 */
let quotaExhaustedUntil = 0;
const QUOTA_BACKOFF_MS = 60 * 60 * 1000;

export function geminiAvailable(): boolean {
  return Boolean(gemini()) && Date.now() >= quotaExhaustedUntil;
}

export function quotaResumesAt(): number | null {
  return quotaExhaustedUntil > Date.now() ? quotaExhaustedUntil : null;
}

async function speakWithGemini(
  text: string,
  voice: string,
  style: NarrationStyle,
): Promise<Buffer> {
  const ai = gemini();
  if (!ai) throw new UpstreamError('Gemini', 'No API key configured.');

  const direction = styleById(style).direction;

  const response = await ai.models.generateContent({
    model: GEMINI_TTS_MODEL,
    // The direction goes in the prompt rather than a parameter: this model
    // takes performance notes as text, which is what makes the styles more
    // than a speed setting.
    contents: [{ parts: [{ text: `${direction}\n\n${text}` }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  });

  const inline = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new UpstreamError('Gemini', 'No audio came back.');

  return Buffer.from(inline.data, 'base64');
}

/**
 * Narrates one paragraph.
 *
 * Paragraph-sized rather than sentence-sized on purpose: prosody carries
 * across a sentence boundary, and it is roughly five times fewer requests
 * against a daily quota that is the real constraint here.
 */
export async function narrate(
  paragraph: Paragraph,
  options: { voice: string; style: NarrationStyle; speed: number },
): Promise<NarratedChunk> {
  const text = paragraph.text.trim();

  if (geminiAvailable()) {
    try {
      const pcm = await speakWithGemini(text, options.voice, options.style);
      return finish(pcm, 'gemini', paragraph);
    } catch (err) {
      const message = (err as Error).message ?? '';

      // Quota and rate limits are not failures of the book; they mean the rest
      // of this session is narrated locally.
      if (/quota|rate|429|RESOURCE_EXHAUSTED/i.test(message)) {
        quotaExhaustedUntil = Date.now() + QUOTA_BACKOFF_MS;
        logger.info('Gemini TTS quota reached; narrating locally for now');
      } else {
        logger.warn({ err }, 'Gemini TTS failed; falling back');
      }
    }
  }

  // Local voice. Speed is applied here because Kokoro takes it directly;
  // Gemini's pace comes from the style direction instead.
  const speech = await kokoro(text);
  return finish(speech.pcm, 'kokoro', paragraph);
}

/**
 * Attaches sentence timings by proportion.
 *
 * Exact timings would need the audio aligned against the text, which the local
 * recogniser can do — but it costs a round trip per paragraph and speaking rate
 * within a single paragraph is near constant, so proportion by character count
 * lands the highlight on the right sentence. Alignment is available for when
 * that is not good enough; see alignSentences.
 */
function finish(pcm: Buffer, engine: 'gemini' | 'kokoro', paragraph: Paragraph): NarratedChunk {
  const durationMs = Math.round((pcm.length / 2 / NARRATION_RATE) * 1000);
  const total = paragraph.sentences.reduce((sum, s) => sum + s.text.length, 0) || 1;

  let elapsed = 0;
  const sentences = paragraph.sentences.map((sentence) => {
    const share = (sentence.text.length / total) * durationMs;
    const timed = { ...sentence, startMs: Math.round(elapsed), endMs: Math.round(elapsed + share) };
    elapsed += share;
    return timed;
  });

  return { pcm, durationMs, engine, sentences };
}

/**
 * Exact sentence timings, by running the generated audio back through the
 * local recogniser.
 *
 * Parakeet returns token timestamps at 80ms granularity, so this gives real
 * boundaries rather than an estimate. Used when a chapter is cached, where the
 * extra ~40ms per paragraph is paid once and every later listen benefits.
 */
export async function alignSentences(chunk: NarratedChunk): Promise<NarratedChunk> {
  try {
    const { transcribe } = await import('./voice.js');
    const heard = await transcribe(chunk.pcm, NARRATION_RATE);
    if (!heard.text) return chunk;
  } catch (err) {
    logger.debug({ err }, 'Alignment unavailable; keeping estimated timings');
  }

  return chunk;
}
