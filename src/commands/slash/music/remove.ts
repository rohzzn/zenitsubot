import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, replyNowPlaying } from './ui.js';
import { UserError } from '../../../utils/errors.js';

export const remove = {
  data: { name: 'remove' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    const position = interaction.options.getInteger('position', true);
    const tracks = context.queue.list();

    // Positions are 1-based because that is how /queue numbers them.
    if (position < 1 || position > tracks.length) {
      throw new UserError(
        `There is no track at position ${position}. The queue has ${tracks.length}.`,
      );
    }

    const target = tracks[position - 1]!;
    if (position - 1 === context.queue.position()) {
      throw new UserError('That track is playing now. Use `/skip` instead.');
    }

    context.queue.remove(position - 1);
    await replyNowPlaying(interaction, context, { note: `Removed ${target.title}` });
  },
};
