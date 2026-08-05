import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { webSearch, asPromptContext, SearchUnavailableError } from '../../../services/search.js';
import {
  chat,
  aiConfigured,
  activeModel,
  AiUnavailableError,
  type ChatMessage,
} from '../../../services/ai.js';
import { logger } from '../../../services/logger.js';

const EMBED_DESCRIPTION_LIMIT = 4000;

/**
 * Search results are fed in as context rather than exposed as a tool call.
 * Free models vary wildly in tool-calling support, and grounding every answer
 * guarantees the model sees current information instead of relying on whatever
 * its training cutoff was.
 */
const SYSTEM_PROMPT = [
  'You are a concise research assistant answering inside a Discord message.',
  'Answer the question using the numbered web results provided.',
  'Cite the results you rely on inline as [1], [2] and so on.',
  'If the results do not actually answer the question, say so plainly instead of guessing.',
  'Prefer recent information and mention dates when they matter.',
  'Keep the answer under 250 words. Use short paragraphs or bullets, and no headings.',
].join(' ');

export const ask = {
  data: { name: 'ask' },
  category: 'ai',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const question = interaction.options.getString('question', true).trim();
    const useSearch = interaction.options.getBoolean('search') ?? true;

    if (!aiConfigured()) {
      await interaction.reply({
        content:
          'No AI key is configured yet. Create a free key at <https://openrouter.ai/keys> and set `OPENROUTER_API_KEY` in `.env`, then restart the bot.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      let sources: Array<{ title: string; url: string }> = [];
      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

      if (useSearch) {
        try {
          const { results, answers } = await webSearch(question, { limit: 6 });
          sources = results.map((r) => ({ title: r.title, url: r.url }));

          const context = asPromptContext(results);
          const instant = answers.length ? `Instant answers:\n${answers.join('\n')}\n\n` : '';

          messages.push({
            role: 'user' as const,
            content:
              `${instant}Web results:\n\n${context}\n\n` +
              `Today's date is ${new Date().toISOString().slice(0, 10)}.\n` +
              `Question: ${question}`,
          });
        } catch (err) {
          // Search being down should degrade to an unsourced answer, not fail.
          if (!(err instanceof SearchUnavailableError)) throw err;
          logger.warn({ err }, 'Answering without search context');
          messages.push({
            role: 'user' as const,
            content: `${question}\n\n(Web search is unavailable; answer from your own knowledge and say so.)`,
          });
        }
      } else {
        messages.push({ role: 'user' as const, content: question });
      }

      const completion = await chat(messages);

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setAuthor({ name: question.slice(0, 240) })
        .setDescription(completion.text.slice(0, EMBED_DESCRIPTION_LIMIT))
        .setFooter({
          text: [
            completion.model,
            useSearch && sources.length ? `${sources.length} sources` : 'no search',
            completion.truncated ? 'truncated' : null,
          ]
            .filter(Boolean)
            .join(' | '),
        })
        .setTimestamp();

      if (sources.length) {
        embed.addFields({
          name: 'Sources',
          value: sources
            .slice(0, 6)
            .map((s, i) => `[${i + 1}] [${s.title.slice(0, 70)}](${s.url})`)
            .join('\n')
            .slice(0, 1024),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err instanceof AiUnavailableError || err instanceof SearchUnavailableError) {
        await interaction.editReply(err.message);
        return;
      }
      logger.error({ err, question }, 'Ask command failed');
      await interaction.editReply('Something went wrong answering that.').catch(() => {});
    }
  },
};

export const aimodels = {
  data: { name: 'aimodels' },
  category: 'ai',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models');
      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
        }>;
      };

      const free = (data.data ?? [])
        .filter(
          (m) =>
            parseFloat(m.pricing?.prompt ?? '1') === 0 &&
            parseFloat(m.pricing?.completion ?? '1') === 0,
        )
        .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
        .slice(0, 20);

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`Free OpenRouter models (${free.length})`)
        .setDescription(
          free
            .map((m) => `\`${m.id}\`\n${(m.context_length ?? 0).toLocaleString()} token context`)
            .join('\n\n')
            .slice(0, 4000),
        )
        .setFooter({ text: `Current: ${activeModel()} | set AI_MODEL in .env to change` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, 'Model list failed');
      await interaction.editReply('Could not fetch the model list.').catch(() => {});
    }
  },
};
