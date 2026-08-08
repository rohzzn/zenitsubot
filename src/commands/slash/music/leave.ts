import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';
import { notice } from './ui.js';
import { v2 } from '../../../utils/layout.js';
import { UserError } from '../../../utils/errors.js';

export const leave = {
  data: { name: 'leave' },
  category: 'music',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !shoukaku?.connections.get(guildId)) {
      throw new UserError('I am not in a voice channel.');
    }

    const queued = client.playerManager.getQueue(guildId)?.list().length ?? 0;
    await client.playerManager.destroy(guildId);

    await interaction.reply(
      v2(notice('Left the channel', queued ? `Discarded ${queued} queued tracks.` : undefined)),
    );
  },
};
