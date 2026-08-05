import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { webSearch, SearchUnavailableError } from '../../../services/search.js';
import { logger } from '../../../services/logger.js';

export const search = {
  data: { name: 'search' },
  category: 'ai',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true).trim();
    const category = interaction.options.getString('category') ?? undefined;
    const timeRange = interaction.options.getString('recency') ?? undefined;

    await interaction.deferReply();

    try {
      const { results, answers } = await webSearch(query, { limit: 6, category, timeRange });

      if (results.length === 0 && answers.length === 0) {
        await interaction.editReply(`No results for **${query}**.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`Search: ${query.slice(0, 200)}`)
        .setFooter({ text: 'Results via SearXNG' })
        .setTimestamp();

      if (answers.length > 0) {
        embed.setDescription(answers.slice(0, 2).join('\n\n').slice(0, 1000));
      }

      for (const [i, result] of results.entries()) {
        embed.addFields({
          name: `${i + 1}. ${result.title.slice(0, 240)}`,
          value: `${result.content.slice(0, 250)}\n[Open](${result.url})`.slice(0, 1024),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err instanceof SearchUnavailableError) {
        await interaction.editReply(err.message);
        return;
      }
      logger.error({ err, query }, 'Search command failed');
      await interaction.editReply('Search failed. Try again shortly.').catch(() => {});
    }
  },
};
