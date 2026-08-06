import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import QRCode from 'qrcode';
import { createRequire } from 'node:module';
import type { QRCode as DecodedQR } from 'jsqr';
import { Jimp } from 'jimp';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

const MAX_CONTENT = 1200;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// jsqr is CommonJS with a default export, which NodeNext ESM resolves to the
// module namespace rather than the function. require() gets the callable.
const jsQR = createRequire(import.meta.url)('jsqr') as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => DecodedQR | null;

export const qr = {
  data: { name: 'qr' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'make') {
      const text = interaction.options.getString('text', true);

      if (text.length > MAX_CONTENT) {
        await interaction.reply({
          content: `That is ${text.length} characters. QR codes get unreadable past about ${MAX_CONTENT}.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      try {
        const png = await QRCode.toBuffer(text, {
          type: 'png',
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M',
        });

        const file = new AttachmentBuilder(png, { name: 'qr.png' });
        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.PRIMARY)
          .setTitle('QR code')
          .setDescription(`\`\`\`\n${text.slice(0, 300)}\n\`\`\``)
          .setImage('attachment://qr.png');

        await interaction.editReply({ embeds: [embed], files: [file] });
      } catch (err) {
        logger.error({ err }, 'QR generation failed');
        await interaction.editReply('Could not build a QR code from that.').catch(() => {});
      }
      return;
    }

    // read
    const attachment = interaction.options.getAttachment('image', true);

    if (!attachment.contentType?.startsWith('image/')) {
      await interaction.reply({ content: 'That is not an image.', ephemeral: true });
      return;
    }
    if (attachment.size > MAX_IMAGE_BYTES) {
      await interaction.reply({ content: 'That image is too large to scan.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
      const image = await Jimp.read(Buffer.from(await response.arrayBuffer()));

      // jsQR wants raw RGBA. Jimp's bitmap is already in that layout.
      const { data, width, height } = image.bitmap;
      const found = jsQR(
        new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
        width,
        height,
      );

      if (!found?.data) {
        await interaction.editReply('No QR code found in that image.');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle('QR code decoded')
        .setDescription(`\`\`\`\n${found.data.slice(0, 1500)}\n\`\`\``)
        .setFooter({ text: 'Decoded locally. Treat unknown links with suspicion.' });

      // Ephemeral: QR codes routinely carry wifi passwords and one-time links.
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, 'QR decode failed');
      await interaction.editReply('Could not read that image.').catch(() => {});
    }
  },
};
