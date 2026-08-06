import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { brandEmbed, text } from '../../../utils/ui.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { requireOwner } from '../../../utils/owner.js';
import { formatBytes, parseMagnet, TorrentError } from '../../../services/torrent.js';
import {
  qbitConfigured,
  listTorrents,
  transferInfo,
  addMagnet,
  pauseTorrent,
  resumeTorrent,
  deleteTorrent,
  version,
  formatSpeed,
  formatEta,
  progressBar,
  stateLabel,
  QbitError,
} from '../../../services/qbittorrent.js';
import { logger } from '../../../services/logger.js';

const SETUP_HELP = [
  'qBittorrent is not configured. Add these to `.env.local` and restart:',
  '```',
  'QBIT_URL=http://host.docker.internal:8080',
  'QBIT_USER=admin',
  'QBIT_PASS=your-password',
  '```',
  'Enable the Web UI in qBittorrent under Tools, Options, Web UI.',
].join('\n');

/** Matches a torrent by full hash or a unique prefix. */
function findByHash(torrents: Array<{ hash: string; name: string }>, needle: string) {
  const query = needle.trim().toLowerCase();
  const matches = torrents.filter(
    (t) => t.hash.toLowerCase().startsWith(query) || t.name.toLowerCase().includes(query),
  );
  return matches.length === 1 ? matches[0] : null;
}

export const qbit = {
  data: { name: 'qbit' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    // The instance is the owner's own infrastructure, and these actions write
    // to it, so the whole command is owner-gated rather than just the writes.
    if (!(await requireOwner(interaction))) return;

    if (!qbitConfigured()) {
      await interaction.reply({ content: SETUP_HELP, ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    try {
      switch (subcommand) {
        case 'status': {
          const [transfer, torrents, appVersion] = await Promise.all([
            transferInfo(),
            listTorrents(),
            version().catch(() => 'unknown'),
          ]);

          const active = torrents.filter((t) => t.state.includes('DL') || t.dlspeed > 0).length;
          const seeding = torrents.filter((t) => t.state.includes('UP')).length;

          const embed = brandEmbed({
            author: { name: 'qBittorrent' },
            title: 'Status',
            footer: `qBittorrent ${text(appVersion)}`,
          });

          embed.addFields(
            { name: 'Download', value: formatSpeed(transfer.dl_info_speed), inline: true },
            { name: 'Upload', value: formatSpeed(transfer.up_info_speed), inline: true },
            { name: 'Connection', value: text(transfer.connection_status), inline: true },
            { name: 'Torrents', value: String(torrents.length), inline: true },
            { name: 'Active', value: String(active), inline: true },
            { name: 'Seeding', value: String(seeding), inline: true },
            {
              name: 'Session totals',
              value: `${formatBytes(transfer.dl_info_data)} down, ${formatBytes(transfer.up_info_data)} up`,
              inline: false,
            },
          );

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        case 'list': {
          const filter = interaction.options.getString('filter') ?? 'all';
          const torrents = await listTorrents(filter);

          if (torrents.length === 0) {
            await interaction.editReply(
              filter === 'all' ? 'No torrents.' : `No torrents matching **${filter}**.`,
            );
            return;
          }

          const embed = brandEmbed({
            author: { name: 'qBittorrent' },
            title: `Torrents (${torrents.length})`,
            footer: 'Hashes are shortened; the first 8 characters are enough to act on',
          });

          for (const torrent of torrents.slice(0, 10)) {
            const speed =
              torrent.dlspeed > 0
                ? `down ${formatSpeed(torrent.dlspeed)}, eta ${formatEta(torrent.eta)}`
                : torrent.upspeed > 0
                  ? `up ${formatSpeed(torrent.upspeed)}`
                  : stateLabel(torrent.state);

            embed.addFields({
              name: text(torrent.name).slice(0, 250),
              value: [
                progressBar(torrent.progress),
                `${formatBytes(torrent.size)} · ${speed}`,
                `seeds ${torrent.num_seeds} · peers ${torrent.num_leechs} · ratio ${torrent.ratio.toFixed(2)}`,
                `\`${torrent.hash.slice(0, 8)}\``,
              ].join('\n'),
              inline: false,
            });
          }

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        case 'add': {
          const link = interaction.options.getString('magnet', true).trim();

          // Validate locally so a typo does not reach qBittorrent as junk.
          let parsed;
          try {
            parsed = parseMagnet(link);
          } catch (err) {
            await interaction.editReply(
              err instanceof TorrentError ? err.message : 'That is not a valid magnet link.',
            );
            return;
          }

          const category = interaction.options.getString('category') ?? undefined;
          await addMagnet(link, category);

          const embed = brandEmbed({
            color: ZENITSU_THEME.SUCCESS,
            author: { name: 'qBittorrent' },
            title: 'Added to queue',
            description: text(parsed.name, parsed.infoHash),
            footer: 'It may take a moment to appear in /qbit list',
          });

          embed.addFields(
            { name: 'Infohash', value: `\`${parsed.infoHash}\``, inline: false },
            { name: 'Category', value: text(category, 'none'), inline: true },
            { name: 'Trackers', value: String(parsed.trackers.length), inline: true },
          );

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        case 'pause':
        case 'resume': {
          const needle = interaction.options.getString('torrent', true);
          const torrents = await listTorrents();
          const match = findByHash(torrents, needle);

          if (!match) {
            await interaction.editReply(
              `No single torrent matches \`${needle}\`. Use \`/qbit list\` and pass a hash prefix.`,
            );
            return;
          }

          if (subcommand === 'pause') await pauseTorrent(match.hash);
          else await resumeTorrent(match.hash);

          await interaction.editReply(
            `${subcommand === 'pause' ? 'Paused' : 'Resumed'} **${match.name.slice(0, 150)}**.`,
          );
          return;
        }

        case 'remove': {
          const needle = interaction.options.getString('torrent', true);
          const withFiles = interaction.options.getBoolean('delete_files') ?? false;

          const torrents = await listTorrents();
          const match = findByHash(torrents, needle);

          if (!match) {
            await interaction.editReply(
              `No single torrent matches \`${needle}\`. Use \`/qbit list\` and pass a hash prefix.`,
            );
            return;
          }

          await deleteTorrent(match.hash, withFiles);

          await interaction.editReply(
            `Removed **${match.name.slice(0, 150)}**` +
              (withFiles ? ' and deleted its files.' : '. Files were kept on disk.'),
          );
          return;
        }

        default:
          await interaction.editReply('Unknown subcommand.');
      }
    } catch (err) {
      if (err instanceof QbitError) {
        await interaction.editReply(err.message);
        return;
      }
      logger.error({ err, subcommand }, 'qbit command failed');
      await interaction.editReply('qBittorrent request failed.').catch(() => {});
    }
  },
};
