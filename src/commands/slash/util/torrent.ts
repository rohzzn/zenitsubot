import type { Client, ChatInputCommandInteraction } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Message,
} from 'discord.js';
import { brandEmbed, pagerRow, count, text } from '../../../utils/ui.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import {
  searchArchive,
  magnetForArchiveItem,
  parseMagnet,
  formatBytes,
  TorrentError,
  type TorrentResult,
} from '../../../services/torrent.js';
import { logger } from '../../../services/logger.js';

const BROWSE_TIMEOUT_MS = 5 * 60 * 1000;
const GET_MAGNET_ID = 'torrent_magnet';

function resultEmbed(result: TorrentResult, index: number, total: number) {
  const embed = brandEmbed({
    author: { name: `Internet Archive - ${index + 1} of ${total}` },
    title: text(result.title, result.identifier),
    url: result.pageUrl,
    footer: 'Public domain and openly licensed material',
  });

  embed.addFields(
    { name: 'Type', value: text(result.mediatype, 'unknown'), inline: true },
    { name: 'Size', value: text(formatBytes(result.size)), inline: true },
    { name: 'Downloads', value: text(count(result.downloads)), inline: true },
  );

  if (result.creator) {
    embed.addFields({ name: 'Creator', value: text(result.creator).slice(0, 200), inline: true });
  }
  if (result.year) {
    embed.addFields({ name: 'Year', value: text(result.year), inline: true });
  }

  embed.addFields({ name: 'Identifier', value: `\`${result.identifier}\``, inline: false });

  return embed;
}

function controls(index: number, total: number) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (total > 1) rows.push(pagerRow(index, total));

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(GET_MAGNET_ID)
        .setLabel('Get magnet link')
        .setStyle(ButtonStyle.Success),
    ),
  );

  return rows;
}

export const torrent = {
  data: { name: 'torrent' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true).trim();
    await interaction.deferReply();

    let results: TorrentResult[];
    try {
      results = await searchArchive(query, 8);
    } catch (err) {
      await interaction.editReply(err instanceof TorrentError ? err.message : 'Search failed.');
      return;
    }

    if (results.length === 0) {
      await interaction.editReply(`Nothing found for **${query}**.`);
      return;
    }

    let index = 0;
    const payload = () => ({
      embeds: [resultEmbed(results[index]!, index, results.length)],
      components: controls(index, results.length),
    });

    const message = (await interaction.editReply(payload())) as Message;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: BROWSE_TIMEOUT_MS,
    });

    collector.on('collect', async (button) => {
      if (button.user.id !== interaction.user.id) {
        await button.reply({ content: 'Run `/torrent` yourself to browse.', ephemeral: true });
        return;
      }

      if (button.customId === GET_MAGNET_ID) {
        // Fetching and parsing the .torrent takes a moment.
        await button.deferReply({ ephemeral: true });

        try {
          const details = await magnetForArchiveItem(results[index]!);

          const embed = brandEmbed({
            author: { name: 'Magnet link' },
            title: details.name.slice(0, 240),
            description: `\`\`\`\n${details.magnet}\n\`\`\``,
            footer: 'Copy the link above into your torrent client',
          });

          embed.addFields(
            { name: 'Infohash', value: `\`${details.infoHash}\``, inline: false },
            { name: 'Size', value: formatBytes(details.totalBytes), inline: true },
            { name: 'Files', value: String(details.fileCount), inline: true },
            { name: 'Trackers', value: String(details.trackers.length), inline: true },
          );

          await button.editReply({ embeds: [embed] });
        } catch (err) {
          await button.editReply(
            err instanceof TorrentError ? err.message : 'Could not build a magnet for that item.',
          );
        }
        return;
      }

      switch (button.customId) {
        case 'pager_first':
          index = 0;
          break;
        case 'pager_prev':
          index = Math.max(0, index - 1);
          break;
        case 'pager_next':
          index = Math.min(results.length - 1, index + 1);
          break;
        case 'pager_last':
          index = results.length - 1;
          break;
        default:
          return;
      }

      await button.update(payload());
    });

    collector.on('end', () => {
      void interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export const magnet = {
  data: { name: 'magnet' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const input = interaction.options.getString('link', true);

    try {
      const parsed = parseMagnet(input);

      const embed = brandEmbed({
        author: { name: 'Magnet decoded' },
        title: parsed.name ?? 'Unnamed torrent',
        footer: 'Read from the link text alone; nothing was contacted',
      });

      embed.addFields(
        { name: 'Infohash', value: `\`${parsed.infoHash}\``, inline: false },
        {
          name: 'Declared size',
          value: parsed.sizeBytes ? formatBytes(parsed.sizeBytes) : 'not declared',
          inline: true,
        },
        { name: 'Trackers', value: String(parsed.trackers.length), inline: true },
        { name: 'Web seeds', value: String(parsed.webSeeds.length), inline: true },
      );

      if (parsed.trackers.length) {
        embed.addFields({
          name: 'Announce URLs',
          value: parsed.trackers
            .slice(0, 8)
            .map((t) => `- ${t}`)
            .join('\n')
            .slice(0, 1024),
          inline: false,
        });
      }

      // Ephemeral: whatever someone is decoding is their business.
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      if (err instanceof TorrentError) {
        await interaction.reply({ content: err.message, ephemeral: true });
        return;
      }
      logger.error({ err }, 'Magnet decode failed');
      await interaction.reply({ content: 'Could not read that magnet link.', ephemeral: true });
    }
  },
};
