import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const kiss = {
  data: { name: 'kiss', description: 'Kiss someone!' },
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser('user');
    await interaction.deferReply();
    try {
      const apiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
      const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent('anime kiss cute')}&key=${apiKey}&client_key=zenitsubot&limit=50&media_filter=gif&contentfilter=high`;
      const response = await fetch(url);
      const data = await response.json() as any;
      if (!data.results?.length) { await interaction.editReply('No GIF found!'); return; }
      const gifUrl = data.results[Math.floor(Math.random() * data.results.length)].media_formats.gif.url;
      const description = !target || target.id === interaction.user.id 
        ? `**${interaction.user.username}** kisses the air! 💋`
        : `**${interaction.user.username}** kisses **${target.username}**! 💋`;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(ZENITSU_THEME.PRIMARY).setDescription(description).setImage(gifUrl).setFooter({ text: 'Powered by Tenor' }).setTimestamp()] });
    } catch (err: any) {
      logger.error({ err }, 'Kiss command error');
      await interaction.editReply('Failed to get GIF!').catch(() => {});
    }
  },
};


