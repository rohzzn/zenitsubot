import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, replyNowPlaying } from './ui.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { v2 } from '../../../utils/layout.js';
import { notice } from './ui.js';

export const skip = {
  data: { name: 'skip' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    const skipped = context.queue.now();

    // Advance explicitly rather than relying on stopTrack — a stop-triggered
    // 'end' event is deliberately ignored, so it would just halt playback.
    const advanced = await client.playerManager.advance(context.guildId);

    if (!advanced) {
      await context.player.stopTrack();
      await interaction.reply(
        v2(
          notice(
            'Queue finished',
            skipped ? `Skipped **${skipped.title}**. Nothing left to play.` : undefined,
          ),
        ),
      );
      return;
    }

    await replyNowPlaying(interaction, context, {
      note: skipped ? `Skipped ${skipped.title}` : undefined,
      accent: ZENITSU_THEME.PRIMARY,
    });
  },
};
