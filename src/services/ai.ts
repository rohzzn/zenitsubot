import { getPrisma } from './db.js';
import { logger } from './logger.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TIMEOUT_MS = 90_000;
const MODEL_SETTING_KEY = 'ai.model';

/**
 * Strongest free model on OpenRouter: 550B parameters, 1M token context, and
 * it keeps its chain of thought in a separate `reasoning` field rather than
 * bleeding it into the answer.
 */
export const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

/** Cached so every message does not hit the database for the model name. */
let cachedModel: string | null = null;

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function activeModel(): Promise<string> {
  if (cachedModel) return cachedModel;

  try {
    const row = await getPrisma().botSetting.findUnique({ where: { key: MODEL_SETTING_KEY } });
    cachedModel = row?.value ?? process.env.AI_MODEL ?? DEFAULT_MODEL;
  } catch {
    cachedModel = process.env.AI_MODEL ?? DEFAULT_MODEL;
  }
  return cachedModel;
}

export async function setActiveModel(model: string): Promise<void> {
  await getPrisma().botSetting.upsert({
    where: { key: MODEL_SETTING_KEY },
    create: { key: MODEL_SETTING_KEY, value: model },
    update: { value: model },
  });
  cachedModel = model;
}

export interface FreeModel {
  id: string;
  contextLength: number;
}

/** Zero-cost models, largest context first. */
export async function listFreeModels(): Promise<FreeModel[]> {
  const response = await fetch(MODELS_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new AiUnavailableError(`Model list returned ${response.status}`);

  const data = (await response.json()) as {
    data?: Array<{
      id: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };

  return (data.data ?? [])
    .filter(
      (m) =>
        parseFloat(m.pricing?.prompt ?? '1') === 0 &&
        parseFloat(m.pricing?.completion ?? '1') === 0,
    )
    .map((m) => ({ id: m.id, contextLength: m.context_length ?? 0 }))
    .sort((a, b) => b.contextLength - a.contextLength);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokens?: number;
  truncated: boolean;
}

export async function chat(
  messages: ChatMessage[],
  options: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<CompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError(
      'No OpenRouter API key is configured. Set OPENROUTER_API_KEY and restart.',
    );
  }

  const model = options.model ?? (await activeModel());

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/rohzzn/zenitsubot',
        'X-Title': 'ZenitsuBot',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 1500,
        temperature: options.temperature ?? 0.4,
      }),
    });

    const data = (await response.json()) as any;

    if (!response.ok || data.error) {
      const message = data.error?.message ?? `HTTP ${response.status}`;

      if (response.status === 429 || /rate/i.test(message)) {
        throw new AiUnavailableError(
          `**${model}** is rate limited right now. Free models share a quota. Try again shortly, or switch with \`/aimodel set\`.`,
        );
      }
      if (response.status === 401) {
        throw new AiUnavailableError('OpenRouter rejected the API key.');
      }
      if (response.status === 404) {
        throw new AiUnavailableError(
          `**${model}** is not available. Pick another with \`/aimodel list\`.`,
        );
      }
      throw new AiUnavailableError(message);
    }

    const choice = data.choices?.[0];
    // Reasoning models keep their chain of thought in a separate field; only
    // fall back to it if content came back genuinely empty.
    const text: string =
      (choice?.message?.content || '').trim() || (choice?.message?.reasoning || '').trim();

    if (!text) throw new AiUnavailableError('The model returned an empty response. Try again.');

    return {
      text,
      model: data.model ?? model,
      tokens: data.usage?.total_tokens,
      truncated: choice?.finish_reason === 'length',
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;

    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new AiUnavailableError('The model took too long to respond.');
    }

    logger.error({ err, model }, 'AI completion failed');
    throw new AiUnavailableError('Could not reach the AI service.');
  }
}

/** Model used for spoken replies unless overridden. */
export const VOICE_MODEL_SETTING_KEY = 'ai.voiceModel';

/**
 * Default for spoken replies, which is not the default for text.
 *
 * Voice is decided by time-to-first-sentence, not by how good the answer
 * eventually gets, and the two rank models very differently. Measured on
 * OpenRouter's free tier for a short spoken question:
 *
 *   inclusionai/ling-3.0-tiny           ~1020ms to first sentence
 *   google/gemma-4-26b-a4b-it           ~1430ms
 *   nvidia/nemotron-3-ultra-550b-a55b   ~2610ms   <- the text default
 *   openai/gpt-oss-20b                 ~18800ms
 *
 * Speed is not the deciding factor, though. ling-3.0-tiny is the fastest and
 * is not the default, because it intermittently streams its own reasoning as
 * ordinary content and closes it with a bare `</think>` — no opening tag. Over
 * a five-turn conversation that produced "You asked me to explain what
 * recursion is. You asked me to explain what recursion is." Streaming cannot
 * fix this after the fact: the first copy has already been spoken by the time
 * the tag arrives. The nemotron nano reasoning variants are worse, narrating
 * "We need to respond as a voice assistant..." aloud.
 *
 * gemma-4-26b-a4b was clean across every test turn and writes numbers as words
 * ("seventy percent"), which is what you want read aloud. It costs about 400ms
 * more to first sentence, and free-tier latency varies a lot regardless — one
 * turn in five took 12 seconds. That variance is the tier, not the model.
 */
export const DEFAULT_VOICE_MODEL = 'google/gemma-4-26b-a4b-it:free';

export async function activeVoiceModel(): Promise<string> {
  try {
    const row = await getPrisma().botSetting.findUnique({
      where: { key: VOICE_MODEL_SETTING_KEY },
    });
    return row?.value ?? process.env.AI_VOICE_MODEL ?? DEFAULT_VOICE_MODEL;
  } catch {
    return process.env.AI_VOICE_MODEL ?? DEFAULT_VOICE_MODEL;
  }
}

/**
 * Streams a completion, handing back each delta as it arrives.
 *
 * Speaking cannot wait for a finished answer: the model's whole generation
 * time would be added to the silence. Streaming lets the first sentence be
 * synthesised and played while the rest is still being written, which is the
 * single largest saving available in the pipeline.
 */
export async function askStream(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  options: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError(
      'No OpenRouter API key is configured. Set OPENROUTER_API_KEY and restart.',
    );
  }

  const model = options.model ?? (await activeVoiceModel());

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/rohzzn/zenitsubot',
      'X-Title': 'ZenitsuBot',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      // Short on purpose: nobody wants a paragraph read to them, and every
      // extra token is time spent not talking.
      max_tokens: options.maxTokens ?? 160,
      temperature: options.temperature ?? 0.5,
    }),
  });

  if (!response.ok || !response.body) {
    if (response.status === 429) {
      throw new AiUnavailableError(
        `**${model}** is rate limited. Free models share a quota — try again shortly.`,
      );
    }
    throw new AiUnavailableError(`The model returned HTTP ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });

    // Server-sent events arrive split across reads, so the last partial line
    // is kept back rather than parsed.
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;

      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // A malformed chunk is not worth abandoning the stream over.
      }
    }
  }

  return full;
}
