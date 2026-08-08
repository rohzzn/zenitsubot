import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, replyNowPlaying } from './ui.js';
import { bar } from '../../../utils/layout.js';

export const volume = {
  data: { name: 'volume' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    const level = interaction.options.getInteger('level', true);
    await context.player.setGlobalVolume(level);

    // The bar makes a relative change readable at a glance in a way a
    // percentage does not — you can see how much headroom is left.
    await replyNowPlaying(interaction, context, {
      note: `Volume \`${bar(level / 100, 12)}\` ${level}%`,
    });
  },
};
