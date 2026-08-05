import type { Client, Message } from 'discord.js';
import { ChannelType } from 'discord.js';
import { chat, aiConfigured, AiUnavailableError, type ChatMessage } from '../services/ai.js';
import { webSearch, asPromptContext } from '../services/search.js';
import { isBlacklisted } from '../services/blacklist.js';
import { logger } from '../services/logger.js';

const MAX_REPLY_CHARS = 1900;
const HISTORY_LIMIT = 8;
const COOLDOWN_MS = 4000;

/** Per-user cooldown so one person cannot pin the free model quota. */
const lastUsed = new Map<string, number>();

const SYSTEM_PROMPT = [
  'You are Zenitsu, a helpful assistant in a Discord server.',
  'Be direct and conversational. Match the length of the question: one line for simple things.',
  'Never use emoji. Never roleplay or use catchphrases.',
  'If web results are provided, prefer them over your own knowledge and cite them as [1], [2].',
  'If you do not know something and have no results, say so.',
].join(' ');

/**
 * Decides whether a question needs fresh information. Cheap heuristic rather
 * than a model call, because a round trip to classify would double latency.
 */
function needsSearch(text: string): boolean {
  return /\b(latest|current|today|todays|now|recent|news|20\d\d|this (week|month|year)|who is|what is|when (is|did|was)|price of|release date|version)\b/i.test(
    text,
  );
}

function stripMention(content: string, botId: string): string {
  return content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a long answer on paragraph or sentence boundaries. */
function chunk(text: string, size = MAX_REPLY_CHARS): string[] {
  if (text.length <= size) return [text];

  const parts: string[] = [];
  let rest = text;

  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf('. ', size);
    if (cut < size * 0.5) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Builds recent thread context so follow-ups work naturally.
 * Only messages between this user and the bot are included, so an unrelated
 * busy channel does not poison the conversation.
 */
async function recentContext(message: Message, botId: string): Promise<ChatMessage[]> {
  try {
    const history = await message.channel.messages.fetch({ limit: 25, before: message.id });

    return [...history.values()]
      .reverse()
      .filter((m) => m.author.id === botId || m.author.id === message.author.id)
      .filter((m) => m.content.trim().length > 0)
      .slice(-HISTORY_LIMIT)
      .map((m) => ({
        role: m.author.id === botId ? ('assistant' as const) : ('user' as const),
        content: stripMention(m.content, botId).slice(0, 600),
      }));
  } catch {
    return [];
  }
}

export function registerMentionChatListener(client: Client) {
  client.on('messageCreate', async (message: Message) => {
    if (message.author.bot || !client.user) return;

    const isDm = message.channel.type === ChannelType.DM;
    const mentioned = message.mentions.users.has(client.user.id);

    // Replying to one of the bot's messages continues the conversation without
    // needing another mention. Discord includes content on a reply to the bot
    // for the same reason it does for mentions.
    let isReplyToBot = false;
    if (!mentioned && !isDm && message.reference?.messageId) {
      const parent = await message.fetchReference().catch(() => null);
      isReplyToBot = parent?.author.id === client.user.id;
    }

    // Discord delivers message content without the privileged intent only for
    // DMs, mentions, and replies to the bot, which is exactly what we handle.
    if (!mentioned && !isDm && !isReplyToBot) return;
    if (isBlacklisted(message.author.id, message.guildId)) return;

    const question = stripMention(message.content, client.user.id);
    if (!question) {
      await message.reply('Ask me something, or use `/help` to see what I can do.').catch(() => {});
      return;
    }

    if (!aiConfigured()) {
      await message
        .reply('No AI key is configured yet. Set `OPENROUTER_API_KEY` and restart me.')
        .catch(() => {});
      return;
    }

    const since = Date.now() - (lastUsed.get(message.author.id) ?? 0);
    if (since < COOLDOWN_MS) return;
    lastUsed.set(message.author.id, Date.now());

    try {
      // Group DM channels lack send/sendTyping, so narrow before using them.
      const channel = message.channel;
      if (!channel.isSendable()) return;

      await channel.sendTyping();

      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
      messages.push(...(await recentContext(message, client.user.id)));

      let sources: string[] = [];

      if (needsSearch(question)) {
        try {
          const { results } = await webSearch(question, { limit: 5 });
          if (results.length) {
            sources = results.map((r) => r.url);
            messages.push({
              role: 'user',
              content:
                `Web results for context:\n\n${asPromptContext(results)}\n\n` +
                `Today is ${new Date().toISOString().slice(0, 10)}.\n\nQuestion: ${question}`,
            });
          } else {
            messages.push({ role: 'user', content: question });
          }
        } catch {
          messages.push({ role: 'user', content: question });
        }
      } else {
        messages.push({ role: 'user', content: question });
      }

      const completion = await chat(messages, { maxTokens: 1200 });

      let reply = completion.text;
      if (sources.length) {
        reply += `\n\n-# ${sources.slice(0, 3).join(' · ')}`;
      }

      const parts = chunk(reply);
      await message.reply(parts[0]!);
      for (const part of parts.slice(1)) {
        await channel.send(part);
      }
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        await message.reply(err.message).catch(() => {});
        return;
      }
      logger.error({ err, user: message.author.id }, 'Mention chat failed');
      await message.reply('Something went wrong answering that.').catch(() => {});
    }
  });
}
