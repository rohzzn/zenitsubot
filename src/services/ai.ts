import { logger } from './logger.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60_000;

/**
 * Default model. Every ":free" model on OpenRouter costs nothing but is rate
 * limited per account, so this is overridable — see AI_MODEL in .env.
 */
const DEFAULT_MODEL = process.env.AI_MODEL ?? 'google/gemma-4-31b-it:free';

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function activeModel(): string {
  return DEFAULT_MODEL;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { message?: string; code?: number };
  usage?: { total_tokens?: number };
  model?: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokens?: number;
  truncated: boolean;
}

export async function chat(
  messages: ChatMessage[],
  options: { model?: string; maxTokens?: number } = {},
): Promise<CompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError(
      'No OpenRouter API key is configured. Set OPENROUTER_API_KEY in .env.',
    );
  }

  const model = options.model ?? DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter uses these for attribution on its dashboard.
        'HTTP-Referer': 'https://github.com/rohzzn/zenitsubot',
        'X-Title': 'ZenitsuBot',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 800,
        temperature: 0.3,
      }),
    });

    const data = (await response.json()) as CompletionResponse;

    if (!response.ok || data.error) {
      const message = data.error?.message ?? `HTTP ${response.status}`;

      // 429 on a free model means the shared free quota is spent, which is
      // worth saying plainly rather than surfacing as a generic failure.
      if (response.status === 429) {
        throw new AiUnavailableError(
          `Rate limited on **${model}**. Free models share a quota — wait a minute, or set AI_MODEL to a different free model.`,
        );
      }
      if (response.status === 401) {
        throw new AiUnavailableError('OpenRouter rejected the API key. Check OPENROUTER_API_KEY.');
      }
      throw new AiUnavailableError(message);
    }

    const choice = data.choices?.[0];
    const text = choice?.message?.content?.trim();

    if (!text) {
      throw new AiUnavailableError('The model returned an empty response. Try again.');
    }

    return {
      text,
      model: data.model ?? model,
      tokens: data.usage?.total_tokens,
      truncated: choice?.finish_reason === 'length',
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;

    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiUnavailableError('The model took too long to respond.');
    }

    logger.error({ err, model }, 'AI completion failed');
    throw new AiUnavailableError('Could not reach the AI service.');
  } finally {
    clearTimeout(timer);
  }
}
