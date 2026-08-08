import { transcribe } from './voice.js';
import { logger } from './logger.js';

/**
 * Deciding whether someone was talking to the bot.
 *
 * Runs entirely on the local Parakeet server, which matters for two reasons.
 * Ordinary conversation between five or ten people never reaches Google at
 * all — only an utterance that actually contains the wake word is forwarded —
 * and at roughly 40ms per utterance the check is cheap enough to run on every
 * turn without anyone noticing.
 *
 * The alternative, streaming everything to a realtime model and letting it
 * decide, would send an entire evening of unrelated conversation off the
 * machine and burn quota on all of it.
 */

/**
 * What "Zenitsu" comes back as.
 *
 * A recogniser trained on English transcribes an unfamiliar Japanese name
 * however it sounds, and it is not consistent about it. These are spellings
 * observed or plausible rather than invented — the local model rendered a
 * clean "Hey Zenitsu" as "Hei Zenitsu" during development, so the leading
 * word is not to be relied on either.
 */
const WAKE_PATTERNS = [
  /**
   * The phonetic shape rather than a list of spellings.
   *
   * Guessing spellings does not work. The list here originally covered
   * zenitsu, zenitzu, senitsu, zanitsu and xenitsu, and the recogniser
   * promptly produced "Zinitsu" — an `i` in the first syllable, which was not
   * among them. Matching the sound instead covers the whole family:
   *
   *   [zsx]  a sibilant start, since z and s are easily confused
   *   vowel  any, because this is the part that varies most
   *   n      the one consonant that survives every mishearing
   *   vowel  optional, "zentsu" happens
   *   t      required, and it is what keeps "sensu" out
   *   [szc]  the affricate
   *
   * Requiring the `t` matters: without it "sensu" and similar ordinary words
   * would wake the bot, and a false wake is worse than a missed one — it sends
   * audio nobody meant to send.
   */
  /\b[zsx][aeiou]{1,2}n[aeiou]{0,2}t[szc][aeiou]?\b/i,

  // Kept explicitly: a hyphen or space between syllables defeats the pattern
  // above, and recognisers do sometimes split an unfamiliar name.
  /\bzen[ _-]it[sz]u\b/i,
  /\bzeni[ _-]tsu\b/i,
];

/** Filler that routinely precedes a name and carries nothing. */
const LEADING_FILLER =
  /^(?:hey|hi|hello|yo|ok|okay|so|um|uh|erm|excuse me|sorry|alright|right)[\s,]+/i;

export interface WakeResult {
  /** Whether the utterance addressed the bot. */
  woken: boolean;
  /** Everything after the wake word — the actual request. */
  request: string;
  /** The full transcript, kept for the on-screen log. */
  heard: string;
  /** Milliseconds the local recogniser took. */
  ms: number;
}

/**
 * Strips the wake word and anything before it.
 *
 * "Zenitsu, who won the game yesterday" has to become "who won the game
 * yesterday", because the request is the rest of the sentence and asking
 * someone to repeat themselves after a wake word is exactly the interaction
 * this is meant to avoid.
 */
export function splitOnWakeWord(text: string): { woken: boolean; request: string } {
  for (const pattern of WAKE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const after = text
      .slice(match.index + match[0].length)
      // Whatever punctuation the recogniser put between the name and the rest.
      .replace(/^[\s,.:;!?-]+/, '')
      .trim();

    return { woken: true, request: after };
  }

  return { woken: false, request: '' };
}

/**
 * Transcribes one utterance locally and reports whether it was for us.
 *
 * The whole utterance is transcribed rather than watching a rolling window.
 * With ten people in a channel a per-speaker rolling window would mean
 * continuous inference on every stream; waiting for the natural end of a
 * sentence costs the silence gap that turn detection needs anyway, and the
 * request is the rest of that same sentence.
 */
export async function checkForWakeWord(pcm: Buffer, sampleRate: number): Promise<WakeResult> {
  try {
    const { text, ms } = await transcribe(pcm, sampleRate);
    const cleaned = text.replace(LEADING_FILLER, '').trim();
    const { woken, request } = splitOnWakeWord(cleaned);

    return { woken, request, heard: text.trim(), ms };
  } catch (err) {
    // A recogniser that is down must not turn into the bot answering
    // everything, so the safe failure is silence.
    logger.debug({ err }, 'Wake word check failed');
    return { woken: false, request: '', heard: '', ms: 0 };
  }
}

/**
 * Whether a follow-up should be taken as still addressed to the bot.
 *
 * Requiring the name on every sentence makes a conversation feel like a
 * command line. For a short window after Zenitsu speaks, the next thing said
 * by the same person is treated as continuing — which is how people actually
 * talk, and it is bounded so the bot does not start answering the room.
 */
export const FOLLOW_UP_WINDOW_MS = 12_000;

export function isFollowUp(
  lastRepliedAt: number | undefined,
  speakerId: string,
  lastSpeakerId: string | undefined,
): boolean {
  if (!lastRepliedAt || speakerId !== lastSpeakerId) return false;
  return Date.now() - lastRepliedAt < FOLLOW_UP_WINDOW_MS;
}
