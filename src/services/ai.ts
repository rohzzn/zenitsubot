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
