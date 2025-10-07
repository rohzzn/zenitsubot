import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getPrisma } from '../../../services/db.js';

export const anime = {
  data: {
    name: 'anime',
    description: 'Anime commands - search, info, alerts, and more',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({ 
      content: '📺 Use the dedicated anime commands:\n' +
               '• `/animesearch <query>` - Search for anime\n' +
               '• `/animeinfo <name>` - Get detailed anime info\n' +
               '• `/animecharacter <name>` - Search characters\n' +
               '• `/animeupcoming` - Top 5 upcoming episodes\n' +
               '• `/animealert add/remove/list` - Episode alerts',
      ephemeral: true 
    });
  },
};

