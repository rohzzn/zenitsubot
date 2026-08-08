import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { requireMusic, requireVoice, replyNowPlaying } from './ui.js';

const MODES = ['off', 'track', 'queue'] as const;

const EXPLANATION: Record<string, string> = {
  off: 'Playing through once',
  track: 'Repeating this track',
  queue: 'Repeating the whole queue',
};

export const loop = {
  data: { name: 'loop' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const context = requireMusic(client, interaction);
    requireVoice(interaction);

    // With no mode given, cycle — which is what the button does, so the two
    // behave the same way.
    const chosen = interaction.options.getString('mode') as (typeof MODES)[number] | null;
    context.queue.loop =
      chosen ?? MODES[(MODES.indexOf(context.queue.loop) + 1) % MODES.length] ?? 'off';

    await replyNowPlaying(interaction, context, {
      note: EXPLANATION[context.queue.loop],
    });
  },
};
