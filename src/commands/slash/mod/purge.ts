import type { Client, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { writeModLog } from '../../../services/modLog.js';

export const purge = {
  data: { name: 'purge' },
  category: 'moderation',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const amount = interaction.options.getInteger('amount', true);

    const channel = interaction.channel as TextChannel;
    // bulkDelete silently skips messages older than 14 days, so report what was
    // actually removed rather than what was asked for.
    const deleted = await channel.bulkDelete(amount, true);

    await interaction.reply({
      content:
        deleted.size < amount
          ? `Deleted ${deleted.size} of ${amount} — the rest were older than 14 days.`
          : `Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'}.`,
      ephemeral: true,
    });

    await writeModLog(client, {
      guildId: interaction.guildId!,
      action: 'Purge',
      target: { id: channel.id, tag: `#${channel.name}` },
      moderator: interaction.user,
      reason: `Bulk deleted ${deleted.size} message(s)`,
    });
  },
};
