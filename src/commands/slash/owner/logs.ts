import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { recentLogs } from '../../../services/logger.js';
import { requireOwner } from '../../../utils/owner.js';

export const logs = {
  data: { name: 'logs' },
  category: 'owner',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await requireOwner(interaction))) return;

    const limit = interaction.options.getInteger('count') ?? 10;
    const entries = recentLogs(limit);

    if (entries.length === 0) {
      await interaction.reply({
        content: 'No warnings or errors recorded since the last restart.',
        ephemeral: true,
      });
      return;
    }

    const lines = entries.map((entry) => {
      const time = new Date(entry.time).toISOString().slice(11, 19);
      const detail = entry.detail ? `\n         ${entry.detail}` : '';
      return `${time} ${entry.level.toUpperCase().padEnd(5)} ${entry.msg}${detail}`;
    });

    // Trim from the oldest end so the newest entries always survive the limit.
    let body = lines.join('\n');
    while (body.length > 3800 && lines.length > 1) {
      lines.pop();
      body = lines.join('\n');
    }

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`Recent warnings and errors (${lines.length})`)
      .setDescription(`\`\`\`\n${body}\n\`\`\``)
      .setFooter({ text: 'In-memory buffer, newest first, cleared on restart' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
