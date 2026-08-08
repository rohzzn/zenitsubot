import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, replyNowPlaying } from './ui.js';
import { UserError } from '../../../utils/errors.js';

export const pause = {
  data: { name: 'pause' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    if (context.player.paused) throw new UserError('Playback is already paused.');

    await context.player.setPaused(true);
    await replyNowPlaying(interaction, context, { heading: 'Paused' });
  },
};
