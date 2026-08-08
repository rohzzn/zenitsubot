import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, replyNowPlaying } from './ui.js';
import { UserError } from '../../../utils/errors.js';

export const resume = {
  data: { name: 'resume' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    if (!context.player.paused) throw new UserError('Playback is not paused.');

    await context.player.setPaused(false);
    await replyNowPlaying(interaction, context, { heading: 'Resumed' });
  },
};
