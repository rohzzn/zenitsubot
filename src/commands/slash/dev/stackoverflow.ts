import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { fetchJson, truncate, relativeTime } from '../../../utils/http.js';
import { logger } from '../../../services/logger.js';

const SO_COLOR = 0xf48024;

interface SoQuestion {
  title: string;
  link: string;
  score: number;
  answer_count: number;
  is_answered: boolean;
  view_count: number;
  creation_date: number;
  tags: string[];
}

/** HTML-decodes the entities the Stack Exchange API returns in titles. */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
  };

  return text
    .replace(/&(?:quot|#39|apos|amp|lt|gt|nbsp);/g, (m) => named[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export const so = {
  data: { name: 'so' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true).trim();
    await interaction.deferReply();

    try {
      const url =
        'https://api.stackexchange.com/2.3/search/advanced' +
        `?order=desc&sort=relevance&q=${encodeURIComponent(query)}` +
        '&site=stackoverflow&pagesize=5&filter=default';

      const data = await fetchJson<{ items?: SoQuestion[] }>(url);
      const items = data?.items ?? [];

      if (items.length === 0) {
        await interaction.editReply(`No Stack Overflow results for **${truncate(query, 100)}**.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(SO_COLOR)
        .setTitle(`Stack Overflow — ${truncate(query, 200)}`)
        .setDescription(
          items
            .map((q, i) => {
              const answered = q.is_answered ? ' [answered]' : '';
              return (
                `**${i + 1}.** [${truncate(decodeEntities(q.title), 110)}](${q.link})${answered}\n` +
                `${q.score} votes · ${q.answer_count} answers · ${q.view_count.toLocaleString()} views · ${relativeTime(q.creation_date * 1000)}`
              );
            })
            .join('\n\n'),
        )
        .setFooter({ text: 'Stack Overflow' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, query }, 'Stack Overflow search failed');
      await interaction.editReply('Stack Overflow search failed. Try again later.').catch(() => {});
    }
  },
};
