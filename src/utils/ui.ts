import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { ZENITSU_THEME } from './constants.js';
import { logger } from '../services/logger.js';

const PAGER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Discord silently drops an embed image whose URL it cannot fetch, which is
 * what makes a card look half-built. Only obvious raster URLs are trusted.
 */
export function usableImage(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('data:')) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  // Embeds cannot render SVG or ICO.
  if (/\.(svg|ico)(\?|$)/i.test(url)) return null;
  return url;
}

/** Applies an image only when it is one Discord will actually display. */
export function setImageIfUsable(embed: EmbedBuilder, url?: string | null): EmbedBuilder {
  const safe = usableImage(url);
  if (safe) embed.setImage(safe);
  return embed;
}

export function setThumbnailIfUsable(embed: EmbedBuilder, url?: string | null): EmbedBuilder {
  const safe = usableImage(url);
  if (safe) embed.setThumbnail(safe);
  return embed;
}

export interface BrandOptions {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  /** Small line above the title, usually the source. */
  author?: { name: string; iconURL?: string; url?: string };
  footer?: string;
  thumbnail?: string | null;
  image?: string | null;
  timestamp?: boolean;
}

/** House style, so every command's output reads as the same bot. */
export function brandEmbed(options: BrandOptions = {}): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(options.color ?? ZENITSU_THEME.PRIMARY);

  if (options.title) embed.setTitle(options.title.slice(0, 250));
  if (options.url) embed.setURL(options.url);
  if (options.description) embed.setDescription(options.description.slice(0, 4000));
  if (options.author) {
    embed.setAuthor({
      name: options.author.name.slice(0, 250),
      iconURL: usableImage(options.author.iconURL) ?? undefined,
      url: options.author.url,
    });
  }
  if (options.footer) embed.setFooter({ text: options.footer.slice(0, 2000) });
  if (options.timestamp !== false) embed.setTimestamp();

  setThumbnailIfUsable(embed, options.thumbnail);
  setImageIfUsable(embed, options.image);

  return embed;
}

const PAGER_IDS = {
  first: 'pager_first',
  prev: 'pager_prev',
  next: 'pager_next',
  last: 'pager_last',
} as const;

export function pagerRow(index: number, total: number): ActionRowBuilder<ButtonBuilder> {
  const atStart = index <= 0;
  const atEnd = index >= total - 1;

  const row = new ActionRowBuilder<ButtonBuilder>();

  // First/Last only earn their place once there is enough to skip through.
  if (total > 3) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(PAGER_IDS.first)
        .setLabel('First')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(atStart),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(PAGER_IDS.prev)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(atStart),
    new ButtonBuilder()
      .setCustomId(PAGER_IDS.next)
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(atEnd),
  );

  if (total > 3) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(PAGER_IDS.last)
        .setLabel('Last')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(atEnd),
    );
  }

  return row;
}

/**
 * Replies with a browsable set of embeds.
 *
 * Anything returning more than one result should use this rather than dumping
 * a list: a single card per item leaves room for the image, which is the part
 * worth looking at.
 */
export async function sendPaged(
  interaction: ChatInputCommandInteraction,
  pages: EmbedBuilder[],
  extra: { content?: string } = {},
): Promise<void> {
  if (pages.length === 0) return;

  const payload = (index: number) => ({
    ...extra,
    embeds: [pages[index]!],
    components: pages.length > 1 ? [pagerRow(index, pages.length)] : [],
  });

  const message = (await interaction.editReply(payload(0))) as Message;
  if (pages.length === 1) return;

  let index = 0;
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PAGER_TIMEOUT_MS,
  });

  collector.on('collect', async (button) => {
    if (button.user.id !== interaction.user.id) {
      await button.reply({ content: 'Run the command yourself to browse.', ephemeral: true });
      return;
    }

    switch (button.customId) {
      case PAGER_IDS.first:
        index = 0;
        break;
      case PAGER_IDS.prev:
        index = Math.max(0, index - 1);
        break;
      case PAGER_IDS.next:
        index = Math.min(pages.length - 1, index + 1);
        break;
      case PAGER_IDS.last:
        index = pages.length - 1;
        break;
      default:
        return;
    }

    await button.update(payload(index));
  });

  collector.on('end', () => {
    void interaction.editReply({ components: [] }).catch(() => {});
  });
}

/** Numbers with thousands separators, or a dash when absent. */
export function count(value?: number | null): string {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

/** Discord relative timestamp from anything date-like. */
export function since(value: string | number | Date): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:R>`;
}

export function logAndFallback(err: unknown, context: Record<string, unknown>, message: string) {
  logger.error({ err, ...context }, message);
}
