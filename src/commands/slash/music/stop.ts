import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, notice } from './ui.js';
import { v2 } from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

export const stop = {
  data: { name: 'stop' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    const cleared = context.queue.list().length;

    await context.player.stopTrack();
    // Via PlayerManager so the guild's wiring state is cleared too.
    await client.playerManager.destroy(context.guildId);

    await interaction.reply(
      v2(
        notice(
          'Stopped',
          `Cleared ${cleared} ${cleared === 1 ? 'track' : 'tracks'} and left the channel.`,
          ZENITSU_THEME.ERROR,
        ),
      ),
    );
  },
};
