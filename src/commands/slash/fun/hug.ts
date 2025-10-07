import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

export const hug = {
  data: {
    name: 'hug',
    description: 'Hug someone (or yourself!)',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser('user');
    await interaction.deferReply();
    
    try {
      // Fetch cute anime hug GIF from Tenor
      const apiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ'; // Public Tenor key
      const searchTerm = 'anime hug cute';
      const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(searchTerm)}&key=${apiKey}&client_key=zenitsubot&limit=50&media_filter=gif&contentfilter=high`;
      
      const response = await fetch(url);
      const data = await response.json() as any;
      
      if (!data.results || data.results.length === 0) {
        await interaction.editReply('Could not find a hug GIF. Try again!');
        return;
      }
      
      const randomGif = data.results[Math.floor(Math.random() * data.results.length)];
      const gifUrl = randomGif.media_formats.gif.url;
      
      let description: string;
      if (!target) {
        description = `**${interaction.user.username}** hugs themselves! 💛`;
      } else if (target.id === interaction.user.id) {
        description = `**${interaction.user.username}** hugs themselves! 💛`;
      } else if (target.bot) {
        description = `**${interaction.user.username}** hugs ${target.username}! 🤖💛`;
      } else {
        description = `**${interaction.user.username}** hugs **${target.username}**! 💛`;
      }
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setDescription(description)
        .setImage(gifUrl)
        .setFooter({ text: 'Powered by Tenor' })
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      logger.error({ err }, 'Hug command error');
      await interaction.editReply('Failed to get hug GIF. Try again!').catch(() => {});
    }
  },
};


