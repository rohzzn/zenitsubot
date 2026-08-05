import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, version as djsVersion } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { shoukaku } from '../../../music/lavalink.js';
import { getPrisma } from '../../../services/db.js';
import { requireOwner } from '../../../utils/owner.js';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const status = {
  data: { name: 'status' },
  category: 'owner',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await requireOwner(interaction))) return;
    await interaction.deferReply({ ephemeral: true });

    const memory = process.memoryUsage();
    const guilds = client.guilds.cache;
    const totalMembers = guilds.reduce((sum, g) => sum + g.memberCount, 0);

    // Lavalink node health is the usual culprit when music "just stops working".
    const nodes = shoukaku ? [...shoukaku.nodes.values()] : [];
    const nodeSummary = nodes.length
      ? nodes
          .map((node) => {
            const stats = node.stats;
            const state = node.state === 2 ? 'connected' : `state ${node.state}`;
            return stats
              ? `${node.name}: ${state}, ${stats.players} players, load ${(stats.cpu.lavalinkLoad * 100).toFixed(1)}%`
              : `${node.name}: ${state}, no stats yet`;
          })
          .join('\n')
      : 'No nodes configured';

    let dbSummary: string;
    try {
      const prisma = getPrisma();
      const [economy, alerts, reminders, warnings] = await Promise.all([
        prisma.userEconomy.count(),
        prisma.animeAlert.count(),
        prisma.reminder.count({ where: { completed: false } }),
        prisma.warning.count(),
      ]);
      dbSummary =
        `${economy} economy profiles\n${alerts} anime alerts\n` +
        `${reminders} pending reminders\n${warnings} warnings`;
    } catch (err) {
      dbSummary = `Unreachable: ${err instanceof Error ? err.message : 'unknown error'}`;
    }

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('Bot status')
      .addFields(
        { name: 'Uptime', value: formatDuration(client.uptime ?? 0), inline: true },
        { name: 'Gateway ping', value: `${Math.round(client.ws.ping)} ms`, inline: true },
        { name: 'Commands', value: `${client.commands.size}`, inline: true },
        { name: 'Guilds', value: `${guilds.size}`, inline: true },
        { name: 'Members', value: totalMembers.toLocaleString(), inline: true },
        { name: 'Voice players', value: `${shoukaku?.players.size ?? 0}`, inline: true },
        {
          name: 'Memory',
          value: `heap ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}\nrss ${formatBytes(memory.rss)}`,
          inline: true,
        },
        {
          name: 'Runtime',
          value: `Node ${process.version}\ndiscord.js ${djsVersion}`,
          inline: true,
        },
        { name: 'Process uptime', value: formatDuration(process.uptime() * 1000), inline: true },
        { name: 'Lavalink', value: nodeSummary, inline: false },
        { name: 'Database', value: dbSummary, inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
