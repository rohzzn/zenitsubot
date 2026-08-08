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
   * Guessing spellings does not work, and this has now been wrong twice. The
   * first version listed zenitsu/zenitzu/senitsu/zanitsu/xenitsu and the
   * recogniser produced "Zinitsu". The second required the `ts` affricate and
   * the recogniser produced "zenito" and "sennetoo" — dropping the `s`
   * altogether, and doubling the `n`.
   *
   * What actually survives every mishearing is the skeleton:
   *
   *   [zsx]        a sibilant start; z and s are freely confused
   *   vowel        varies wildly — e, i, a all observed
   *   n+           one or two, "sennetoo" doubles it
   *   vowel(s)     optional
   *   t+           the one hard consonant that is always there
   *   then either  an affricate (tsu, tzu, tsoo)
   *                or a bare vowel ending (to, too, ta is excluded below)
   *
   * Something is required after the `t`, which is what keeps "sent", "santa",
   * "cent" and "zenith" out. A false wake is worse than a missed one: it sends
   * audio nobody meant to send.
   */
  /\b[zsx][aeiou]{1,2}n+[aeiou]{0,2}t+(?:[szc][aeiou]{0,2}|[ou]{1,2})\b/i,

  // Kept explicitly: a space or hyphen between syllables defeats the pattern
  // above, and recognisers do split an unfamiliar name.
  /\bzen+[ _-]?it[sz]?[ou]{1,2}\b/i,
  /\bzen+i[ _-]ts[ou]\b/i,
  /\bzen+[ _-]it[sz]u\b/i,
];

/**
 * How far a word can be from "zenitsu" and still count.
 *
 * A second chance for spellings the pattern misses. Recognisers rendering an
 * unfamiliar Japanese name are inventive, and the cost of being slightly
 * generous here is bounded — the word still has to start with a sibilant and
 * be roughly the right length.
 */
const MAX_EDIT_DISTANCE = 2;
const TARGET = 'zenitsu';

function editDistance(a: string, b: string): number {
  // Standard Levenshtein, one row at a time; the strings are a handful of
  // characters so nothing cleverer is warranted.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length]!;
}

/**
 * Real words close enough to trip the distance check.
 *
 * "zenith" is two edits from "zenitsu" and is an ordinary English word, so the
 * fuzzy fallback matched it. Anything a person might actually say has to be
 * excluded by name — the pattern above is precise enough not to need this, but
 * the distance check is deliberately loose and needs the guard.
 */
const NOT_THE_NAME = new Set(['zenith', 'zeniths', 'senate', 'seniors', 'seniority', 'sensual']);

/** Whether any single word in the text is a near-miss for the name. */
function hasNearMiss(text: string): { hit: boolean; word?: string } {
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    // Cheap gates first: the sibilant start and a plausible length are what
    // stop this matching half the dictionary.
    if (!/^[zsx]/.test(word)) continue;
    if (word.length < 5 || word.length > 10) continue;
    if (NOT_THE_NAME.has(word)) continue;
    if (editDistance(word, TARGET) <= MAX_EDIT_DISTANCE) return { hit: true, word };
  }

  return { hit: false };
}

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

  // Nothing matched the shape; fall back to spelling distance, which catches
  // renderings the pattern did not anticipate.
  const near = hasNearMiss(text);
  if (near.hit && near.word) {
    const at = text.toLowerCase().indexOf(near.word);
    const after = text
      .slice(at + near.word.length)
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
