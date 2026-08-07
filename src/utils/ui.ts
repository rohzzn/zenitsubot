import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbed,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ZENITSU_THEME } from './constants.js';
import { logger } from '../services/logger.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../listeners/componentRouter.js';

/** Long enough that scrolling back to a result and clicking still works. */
const PAGER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

export const PAGER_KIND = 'pg';

/**
 * The destination page travels in the custom id rather than the direction.
 *
 * Two clicks landing at once used to apply "next" twice to the same starting
 * index; naming the target instead makes each button mean exactly one page no
 * matter what order the clicks arrive in.
 */
const PAGER_IDS = (index: number, total: number) => ({
  first: componentId(PAGER_KIND, 'go', 0),
  prev: componentId(PAGER_KIND, 'go', Math.max(0, index - 1)),
  next: componentId(PAGER_KIND, 'go', Math.min(total - 1, index + 1)),
  last: componentId(PAGER_KIND, 'go', total - 1),
});

export function pagerRow(index: number, total: number): ActionRowBuilder<ButtonBuilder> {
  const ids = PAGER_IDS(index, total);
  const atStart = index <= 0;
  const atEnd = index >= total - 1;

  const row = new ActionRowBuilder<ButtonBuilder>();

  // First/Last only earn their place once there is enough to skip through.
  if (total > 3) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(ids.first)
        .setLabel('First')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(atStart),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(ids.prev)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(atStart),
    new ButtonBuilder()
      .setCustomId(ids.next)
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(atEnd),
  );

  if (total > 3) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(ids.last)
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
/** Pages are stored as plain embed data; builders do not survive JSON. */
interface PagerState {
  pages: APIEmbed[];
  content?: string;
}

function pagerPayload(state: PagerState, index: number) {
  const clamped = Math.min(Math.max(index, 0), state.pages.length - 1);
  return {
    content: state.content ?? '',
    embeds: [state.pages[clamped]!],
    components: state.pages.length > 1 ? [pagerRow(clamped, state.pages.length)] : [],
  };
}

const pagerHandler: ComponentHandler<PagerState> = {
  kind: PAGER_KIND,
  ttlMs: PAGER_TTL_MS,
  expiredMessage: 'These results have expired. Run the command again.',
  async handle({ interaction, args, state }) {
    await interaction.update(pagerPayload(state, Number(args[0] ?? 0)));
  },
};

registerComponentHandler(pagerHandler);

export async function sendPaged(
  interaction: ChatInputCommandInteraction,
  pages: EmbedBuilder[],
  extra: { content?: string } = {},
): Promise<void> {
  if (pages.length === 0) return;

  const state: PagerState = { pages: pages.map((p) => p.toJSON()), content: extra.content };

  const message = await interaction.editReply(pagerPayload(state, 0));

  // A single page has nothing to page through, so nothing needs remembering.
  if (pages.length > 1) {
    await attachState(message.id, pagerHandler, interaction.user.id, state);
  }
}

/** Numbers with thousands separators, or a dash when absent. */
export function count(value?: number | null): string {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

/**
 * Coerces anything into a usable embed field value.
 *
 * Discord rejects a field whose value is empty or not a string, and the error
 * surfaces as an opaque validation failure for the whole embed. APIs are
 * casual about this: the Internet Archive returns `year` as a number, and
 * plenty of fields come back as empty strings that `??` will not catch.
 */
export function text(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined) return fallback;

  const asString = Array.isArray(value) ? value.join(', ') : String(value);
  const trimmed = asString.trim();

  return trimmed.length > 0 ? trimmed.slice(0, 1024) : fallback;
}

/** Discord relative timestamp from anything date-like. */
export function since(value: string | number | Date): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:R>`;
}

export function logAndFallback(err: unknown, context: Record<string, unknown>, message: string) {
  logger.error({ err, ...context }, message);
}
