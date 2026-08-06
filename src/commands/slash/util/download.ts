import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import {
  normaliseUrl,
  downloadWithinBudget,
  formatDuration,
  DownloadError,
} from '../../../services/mediaDownload.js';
import { logger } from '../../../services/logger.js';

/**
 * Discord's per-message upload limit depends on the server's boost tier.
 * Reading it from the guild means a boosted server automatically gets to send
 * bigger files without a code change.
 */
function uploadLimitBytes(interaction: ChatInputCommandInteraction): number {
  const tier = interaction.guild?.premiumTier ?? 0;
  if (tier >= 3) return 100 * 1024 * 1024;
  if (tier >= 2) return 50 * 1024 * 1024;
  return 10 * 1024 * 1024;
}

export const download = {
  data: { name: 'download' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const raw = interaction.options.getString('url', true);
    const audioOnly = interaction.options.getBoolean('audio_only') ?? false;

    let url;
    try {
      url = normaliseUrl(raw);
    } catch (err) {
      await interaction.reply({
        content: err instanceof DownloadError ? err.message : 'Invalid URL.',
        ephemeral: true,
      });
      return;
    }

    // Downloads regularly take longer than the 3 second interaction window.
    await interaction.deferReply();

    const limit = uploadLimitBytes(interaction);

    try {
      const media = await downloadWithinBudget(url, limit, audioOnly);

      const file = new AttachmentBuilder(media.buffer, { name: media.filename });
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(media.info.title.slice(0, 250))
        .setURL(media.info.webpageUrl)
        .setFooter({
          text: [
            media.info.extractor,
            media.info.uploader,
            formatDuration(media.info.durationSeconds),
            `${(media.buffer.length / 1048576).toFixed(1)} MB`,
          ]
            .filter(Boolean)
            .join(' - '),
        });

      await interaction.editReply({ embeds: [embed], files: [file] });
    } catch (err) {
      if (err instanceof DownloadError) {
        await interaction.editReply(err.message);
        return;
      }
      logger.error({ err, url: url.toString() }, 'Download command failed');
      await interaction.editReply('Download failed.').catch(() => {});
    }
  },
};
