import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, replyNowPlaying } from './ui.js';

export const now = {
  data: { name: 'now' },
  category: 'music',

  // No voice check: looking at what is playing is harmless from anywhere.
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    await replyNowPlaying(interaction, requireMusic(client, interaction));
  },
};
