import type { Client, ChatInputCommandInteraction } from 'discord.js';

import { brandEmbed, sendPaged } from '../../../utils/ui.js';
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

    // A batch up front, so Next is instant instead of another round trip.
    const seen = new Set<string>();
    const memes: MemeResponse[] = [];

    try {
      for (let attempt = 0; attempt < 6 && memes.length < 5; attempt++) {
        const subreddit = SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)]!;
        const response = await fetch(`${API_BASE}/${subreddit}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) continue;

        const post = (await response.json()) as MemeResponse;
        if (!post.url || post.nsfw || post.spoiler || seen.has(post.url)) continue;

        seen.add(post.url);
        memes.push(post);
      }

      if (memes.length === 0) {
        await interaction.editReply('Could not find a meme right now. Try again.');
        return;
      }

      const pages = memes.map((post, index) => {
        const title = post.title ?? 'Untitled';
        return brandEmbed({
          author: { name: `r/${post.subreddit ?? 'memes'}` },
          title: title.length > 250 ? `${title.slice(0, 247)}...` : title,
          url: post.postLink,
          image: post.url,
          footer: `${(post.ups ?? 0).toLocaleString()} upvotes  ·  ${index + 1} of ${memes.length}`,
        });
      });

      await sendPaged(interaction, pages);
    } catch (err) {
      logger.error({ err }, 'Meme fetch error');
      await interaction.editReply('Failed to fetch meme. Try again.').catch(() => {});
    }
  },
};
