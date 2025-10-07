import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

const subreddits = ['memes', 'dankmemes', 'me_irl', 'wholesomememes', 'animemes', 'ProgrammerHumor'];

export const meme = {
  data: {
    name: 'meme',
    description: 'Get a random meme from Reddit',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    
    try {
      const subreddit = subreddits[Math.floor(Math.random() * subreddits.length)];
      const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=100`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ZenitsuBot/1.0'
        }
      });
      
      const data = await response.json() as any;
      const posts = data.data.children
        .filter((post: any) => {
          const p = post.data;
          return !p.stickied && 
                 !p.over_18 &&
                 (p.post_hint === 'image' || p.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i));
        });
      
      if (posts.length === 0) {
        await interaction.editReply('No memes found. Try again!');
        return;
      }
      
      const randomPost = posts[Math.floor(Math.random() * posts.length)].data;
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(randomPost.title.length > 256 ? randomPost.title.slice(0, 253) + '...' : randomPost.title)
        .setURL(`https://reddit.com${randomPost.permalink}`)
        .setImage(randomPost.url)
        .setFooter({ text: `r/${subreddit} • 👍 ${randomPost.ups.toLocaleString()}` })
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      logger.error({ err }, 'Meme fetch error');
      await interaction.editReply('Failed to fetch meme. Try again!').catch(() => {});
    }
  },
};


