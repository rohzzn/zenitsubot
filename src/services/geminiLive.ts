import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import { logger } from './logger.js';
import { UpstreamError, UserError } from '../utils/errors.js';
import { webSearch } from './search.js';
import { rememberFact, forgetFact } from './voiceMemory.js';

/**
 * A live conversation with Gemini.
 *
 * Speech goes in and speech comes out over one websocket, with the model doing
 * its own turn detection and its own interruption handling. That is the reason
 * to use it rather than the local transcribe-think-speak pipeline: the seams
 * between those three stages are what make an assembled pipeline sound like an
 * assembled pipeline.
 *
 * Audio contract, which is not negotiable at either end:
 *
 *   in   PCM16 mono 16kHz little-endian
 *   out  PCM16 mono 24kHz little-endian
 *
 * Discord speaks 48kHz stereo, so both directions are resampled around this.
 */

const MODEL = process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview';

export const GEMINI_INPUT_RATE = 16_000;
export const GEMINI_OUTPUT_RATE = 24_000;

/**
 * How Zenitsu talks.
 *
 * Written against the failure mode rather than for it: left alone, a model in
 * this position produces "Certainly! I'd be happy to help with that." — which
 * is instantly recognisable as a bot and kills the illusion the whole design
 * is chasing.
 */
const PERSONA = `You are Zenitsu, sitting in a Discord voice call with a group of friends.

You are a person in the call, not an assistant. Talk like one:
- Keep it short. One or two sentences. People are waiting to talk.
- Be casual and warm. Contractions, ordinary words, the odd "yeah" or "huh".
- React like a person would. Laugh at something funny. Say "oh no" at bad news.
- Never say "Certainly", "How may I assist you", "Great question", "I'd be happy to",
  or anything else that sounds like customer service. If you catch yourself
  starting a sentence that way, start it differently.
- Do not offer follow-up help or ask if there is anything else. Just answer and stop.
- You are allowed to not know things. "No idea" is a real answer.
- You are allowed to have opinions and preferences.
- If something is a joke, treat it as a joke.

When you use search_web:
- Say nothing until the results come back. Do not announce that you are looking,
  do not offer to look, do not ask whether they want you to. Just call it.
- Then answer from what came back, in one or two sentences, like you already knew.
- If nothing useful came back, say you could not find it. Do not offer to try again.
- Never say "I have no idea, but I can check" — if you are calling the tool, you
  are already checking, and saying that out loud wastes everyone's time.

Several people are in the call. Each message tells you who is speaking. Address
them by name when it is natural, not every time.

You only hear people when they say your name, so you are joining conversations
partway through. That is normal — do not comment on it or ask for context you
were not given.`;

export interface LiveEvents {
  /** A chunk of the model's speech, PCM16 24kHz. */
  onAudio: (pcm: Buffer) => void;
  /** The model was cut off; stop playback immediately. */
  onInterrupted: () => void;
  /** The model finished a turn. */
  onTurnComplete: () => void;
  /** What the model said, once known, for the on-screen log. */
  onText?: (text: string) => void;
  /** A tool ran; surfaced so the log can show it looked something up. */
  onTool?: (name: string, summary: string) => void;
  onError?: (message: string) => void;
  onClose?: (reason: string) => void;
}

/**
 * Tools the model may call.
 *
 * Search is declared rather than assumed: the model decides when a question
 * needs current information, which is the behaviour asked for — "what happened
 * with Nvidia today" should search, "what is recursion" should not.
 *
 * Memory is a tool too, so remembering is something the model chooses to do
 * when a person says something worth keeping, rather than a summarisation pass
 * bolted on afterwards.
 */
const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_web',
    description:
      'Look up current information. Use for anything time-sensitive: news, prices, sports ' +
      'results, weather, releases, "today", "latest", "right now". Do not use it for general ' +
      'knowledge, opinions, jokes, or anything you already know.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'What to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description:
      'Save something worth knowing about the person speaking, so you still know it next ' +
      'time. Use it when someone tells you a preference, a fact about themselves, or asks ' +
      'you to remember something. Keep the topic short and reusable.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: 'Short subject, e.g. "job", "timezone".' },
        fact: { type: Type.STRING, description: 'What to remember, in one sentence.' },
      },
      required: ['topic', 'fact'],
    },
  },
  {
    name: 'forget',
    description: 'Forget something you previously remembered about the person speaking.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: 'The topic to forget.' },
      },
      required: ['topic'],
    },
  },
];

export class GeminiLiveSession {
  private session?: Session;
  private closed = false;
  /** Whose turn the model is currently answering, for memory attribution. */
  private speakerId?: string;
  private replyText = '';

  constructor(private readonly events: LiveEvents) {}

  async open(context: string): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      throw new UserError(
        'No Gemini API key is configured. Put `GEMINI_API_KEY=...` in `.env.local` and restart. ' +
          'A key from aistudio.google.com is free.',
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
      this.session = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `${PERSONA}\n\n${context}`,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          // Transcripts of both sides, so the on-screen log can show what was
          // heard and said without a second recognition pass.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => logger.info({ model: MODEL }, 'Gemini Live session open'),
          onmessage: (message) => void this.handle(message),
          onerror: (err) => {
            logger.warn({ err: err?.message }, 'Gemini Live error');
            this.events.onError?.(err?.message ?? 'The live session failed.');
          },
          onclose: (event) => {
            this.closed = true;
            this.events.onClose?.(event?.reason ?? 'closed');
          },
        },
      });
    } catch (err) {
      throw new UpstreamError('Gemini', `Could not open a live session: ${(err as Error).message}`);
    }
  }

  /**
   * Streams audio in as it arrives.
   *
   * Deliberately not buffered into utterances: the model does its own turn
   * detection, and holding audio back to detect the end of a sentence
   * ourselves would reintroduce exactly the latency the Live API removes.
   */
  sendAudio(pcm16k: Buffer, speakerId: string): void {
    if (!this.session || this.closed) return;

    this.speakerId = speakerId;

    try {
      this.session.sendRealtimeInput({
        audio: { data: pcm16k.toString('base64'), mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}` },
      });
    } catch (err) {
      logger.debug({ err }, 'Dropped an audio frame');
    }
  }

  /**
   * Tells the model the speaker has stopped.
   *
   * Necessary because of how Discord works rather than how Gemini does.
   * Gemini's automatic turn detection listens for a pause in the audio, and
   * Discord sends no packets at all during silence — so the stream simply
   * stops and the pause never arrives. Without this the model waits forever:
   * a session opened cleanly, took 1.67s of speech, and answered with nothing.
   */
  endTurn(): void {
    if (!this.session || this.closed) return;

    try {
      this.session.sendRealtimeInput({ audioStreamEnd: true });
    } catch (err) {
      logger.debug({ err }, 'Could not signal end of audio');
    }
  }

  /**
   * Tells the model who just started talking, and what it should know about
   * them, without that text being spoken aloud.
   */
  announceSpeaker(name: string, memory: string): void {
    if (!this.session || this.closed) return;

    try {
      this.session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [{ text: `[${name} is speaking now. What you know about them:\n${memory}]` }],
          },
        ],
        turnComplete: false,
      });
    } catch (err) {
      logger.debug({ err }, 'Could not announce speaker');
    }
  }

  private async handle(message: LiveServerMessage): Promise<void> {
    const content = message.serverContent;

    // Barge-in. The model has been cut off mid-sentence and whatever is still
    // queued for playback is now stale — playing it would have Zenitsu talking
    // over the person who just interrupted it.
    if (content?.interrupted) {
      this.replyText = '';
      this.events.onInterrupted();
      return;
    }

    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.events.onAudio(Buffer.from(part.inlineData.data, 'base64'));
      }
    }

    if (content?.outputTranscription?.text) {
      this.replyText += content.outputTranscription.text;
    }

    if (content?.turnComplete) {
      const said = this.replyText.trim();
      this.replyText = '';
      if (said) this.events.onText?.(said);
      this.events.onTurnComplete();
    }

    if (message.toolCall?.functionCalls?.length) {
      await this.runTools(message.toolCall.functionCalls);
    }
  }

  private async runTools(
    calls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>,
  ): Promise<void> {
    const responses = [];

    for (const call of calls) {
      const args = call.args ?? {};
      let result: unknown;

      try {
        switch (call.name) {
          case 'search_web': {
            const query = String(args.query ?? '').trim();
            const { results: hits, answers } = await webSearch(query, { limit: 5 });

            this.events.onTool?.('search', query);

            result =
              hits.length || answers.length
                ? {
                    // Instant answers first: for "weather tomorrow" or a
                    // scoreline that is the whole answer, and the model should
                    // not have to infer it from three snippets.
                    answers,
                    results: hits.slice(0, 5).map((hit) => ({
                      title: hit.title,
                      snippet: hit.content,
                      url: hit.url,
                      published: hit.publishedDate,
                    })),
                  }
                : { results: [], note: 'Nothing came back. Say you could not find anything.' };
            break;
          }

          case 'remember': {
            if (!this.speakerId) {
              result = { ok: false, note: 'No speaker attributed.' };
              break;
            }
            await rememberFact(
              this.speakerId,
              String(args.topic ?? ''),
              String(args.fact ?? ''),
              false,
            );
            this.events.onTool?.('remember', `${args.topic}: ${args.fact}`);
            result = { ok: true };
            break;
          }

          case 'forget': {
            if (!this.speakerId) {
              result = { ok: false };
              break;
            }
            const removed = await forgetFact(this.speakerId, String(args.topic ?? ''));
            this.events.onTool?.('forget', String(args.topic ?? ''));
            result = { ok: removed };
            break;
          }

          default:
            result = { error: `Unknown tool ${call.name}` };
        }
      } catch (err) {
        logger.warn({ err, tool: call.name }, 'Tool call failed');
        // Returned rather than thrown: the model can say it could not look
        // something up, where a dropped tool response leaves it waiting.
        result = { error: (err as Error).message };
      }

      responses.push({ id: call.id, name: call.name, response: { result } });
    }

    try {
      this.session?.sendToolResponse({ functionResponses: responses });
    } catch (err) {
      logger.warn({ err }, 'Could not send tool responses');
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    try {
      this.session?.close();
    } catch {
      // Already gone.
    }
  }

  get isOpen(): boolean {
    return Boolean(this.session) && !this.closed;
  }
}

export { MODEL as GEMINI_LIVE_MODEL };
