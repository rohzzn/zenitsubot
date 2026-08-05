import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

// Reddit's public .json endpoints now block non-OAuth clients, so we go through
// meme-api, which proxies the same subreddits and needs no credentials.
const API_BASE = 'https://meme-api.com/gimme';

const SUBREDDITS = [
  'memes',
  'dankmemes',
  'me_irl',
  'wholesomememes',
  'animemes',
  'ProgrammerHumor',
];

interface MemeResponse {
  title?: string;
  url?: string;
  postLink?: string;
  subreddit?: string;
  ups?: number;
  nsfw?: boolean;
  spoiler?: boolean;
}

export const meme = {
  data: { name: 'meme' },
  category: 'fun',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      const subreddit = SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)]!;
      const response = await fetch(`${API_BASE}/${subreddit}`);

      if (!response.ok) {
        await interaction.editReply('Could not reach the meme service. Try again!');
        return;
      }

      const post = (await response.json()) as MemeResponse;

      if (!post.url || post.nsfw || post.spoiler) {
        await interaction.editReply('No suitable meme found. Try again!');
        return;
      }

      const title = post.title ?? 'Untitled';
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(title.length > 256 ? `${title.slice(0, 253)}...` : title)
        .setImage(post.url)
        .setFooter({
          text: `r/${post.subreddit ?? subreddit} • ${(post.ups ?? 0).toLocaleString()}`,
        })
        .setTimestamp();

      if (post.postLink) embed.setURL(post.postLink);

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, 'Meme fetch error');
      await interaction.editReply('Failed to fetch meme. Try again!').catch(() => {});
    }
  },
};
