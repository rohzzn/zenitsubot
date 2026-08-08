import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, replyNowPlaying } from './ui.js';
import { UserError } from '../../../utils/errors.js';

export const shuffle = {
  data: { name: 'shuffle' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    const upcoming = context.queue.list().length - context.queue.position() - 1;
    if (upcoming < 2) throw new UserError('There are not enough tracks queued to shuffle.');

    context.queue.shuffle();

    // Shows the new order in the up-next block, so the shuffle is visible
    // rather than asserted.
    await replyNowPlaying(interaction, context, {
      note: `Shuffled ${upcoming} upcoming tracks`,
    });
  },
};
