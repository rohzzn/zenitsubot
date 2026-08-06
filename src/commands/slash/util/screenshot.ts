import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

const BROWSERLESS_URL = process.env.BROWSERLESS_URL ?? 'http://browserless:3000';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN ?? 'zenitsu-local';
const TIMEOUT_MS = 45_000;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

/**
 * Blocks private and loopback targets. The browser runs inside the compose
 * network, so without this a screenshot could be pointed at Lavalink, SearXNG,
 * or anything else on the host's LAN and used to read it.
 */
function isPubliclyRoutable(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are supported.' };
  }

  const host = url.hostname.toLowerCase();

  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    // Bare service names on the compose network have no dot.
    !host.includes('.') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) return { ok: false, reason: 'That address is not publicly routable.' };

  return { ok: true, url };
}

export const screenshot = {
  data: { name: 'screenshot' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const input = interaction.options.getString('url', true).trim();
    const device = (interaction.options.getString('device') ?? 'desktop') as keyof typeof VIEWPORTS;
    const fullPage = interaction.options.getBoolean('full_page') ?? false;

    const check = isPubliclyRoutable(input);
    if (!check.ok) {
      await interaction.reply({ content: check.reason, ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const response = await fetch(
        `${BROWSERLESS_URL}/screenshot?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: check.url.toString(),
            gotoOptions: { waitUntil: 'networkidle2', timeout: 25_000 },
            viewport: VIEWPORTS[device],
            options: { type: 'jpeg', quality: 80, fullPage },
          }),
        },
      );

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        logger.warn({ status: response.status, detail }, 'Screenshot failed');
        await interaction.editReply(
          response.status === 408
            ? 'That page took too long to load.'
            : 'Could not capture that page. It may be blocking automated browsers.',
        );
        return;
      }

      const image = Buffer.from(await response.arrayBuffer());

      if (image.length > 9 * 1024 * 1024) {
        await interaction.editReply(
          'The capture came out too large for Discord. Try without `full_page`.',
        );
        return;
      }

      const file = new AttachmentBuilder(image, { name: 'screenshot.jpg' });
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(check.url.hostname)
        .setURL(check.url.toString())
        .setImage('attachment://screenshot.jpg')
        .setFooter({
          text: `${device}${fullPage ? ', full page' : ''} - ${(image.length / 1024).toFixed(0)} KB`,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [file] });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      logger.error({ err, url: check.url.toString() }, 'Screenshot command failed');
      await interaction
        .editReply(timedOut ? 'That page took too long to load.' : 'Screenshot failed.')
        .catch(() => {});
    }
  },
};
