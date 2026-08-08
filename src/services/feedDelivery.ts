import type { User } from 'discord.js';
import { SectionBuilder } from 'discord.js';
import {
  card,
  paragraph,
  divider,
  gap,
  caption,
  withThumbnail,
  v2Update,
  type Block,
} from '../utils/layout.js';
import { ZENITSU_THEME } from '../utils/constants.js';

/**
 * What a delivered digest looks like.
 *
 * Kept apart from the scheduler so the same rendering serves both the DM and
 * `/feed read`, and so what someone sees on demand is exactly what they would
 * have been sent.
 */

export interface DeliverableItem {
  id: string;
  title: string;
  link: string;
  author?: string | null;
  summary?: string | null;
  imageUrl?: string | null;
  publishedAt?: Date | null;
  feedTitle: string;
  feedIcon?: string | null;
}

/** Discord caps a container at 40 components; this stays well inside it. */
const ITEMS_PER_CARD = 8;

function when(date?: Date | null): string {
  if (!date) return '';
  return ` · <t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/**
 * Renders items grouped by the feed they came from.
 *
 * Grouping matters once someone follows more than two things: an
 * undifferentiated list of headlines from six sites is unreadable, and the
 * source is most of what tells you whether to care.
 */
export function digestBlocks(items: DeliverableItem[], heading?: string): Block[] {
  const byFeed = new Map<string, DeliverableItem[]>();
  for (const item of items) {
    const list = byFeed.get(item.feedTitle) ?? [];
    list.push(item);
    byFeed.set(item.feedTitle, list);
  }

  const blocks: Block[] = [];

  if (heading) {
    blocks.push(
      card(ZENITSU_THEME.PRIMARY).addTextDisplayComponents(
        paragraph(
          `## ${heading}\n${items.length} new ${items.length === 1 ? 'item' : 'items'} across ${byFeed.size} ${byFeed.size === 1 ? 'feed' : 'feeds'}`,
        ),
      ),
    );
  }

  for (const [feedTitle, feedItems] of byFeed) {
    const container = card(ZENITSU_THEME.PRIMARY);

    const icon = feedItems[0]?.feedIcon;
    const title = `### ${feedTitle}`;

    // The feed's icon beside its name, when it publishes one Discord can show.
    const header = withThumbnail(title, icon);
    if (header instanceof SectionBuilder) container.addSectionComponents(header);
    else container.addTextDisplayComponents(header);

    container.addSeparatorComponents(divider());

    for (const [index, item] of feedItems.slice(0, ITEMS_PER_CARD).entries()) {
      if (index > 0) container.addSeparatorComponents(gap());

      const byline = [item.author, when(item.publishedAt)].filter(Boolean).join('');
      const lines = [`**[${item.title}](${item.link})**`];
      if (byline.trim()) lines.push(`-# ${byline.replace(/^ · /, '')}`);
      if (item.summary) lines.push(item.summary.slice(0, 300));

      const body = paragraph(lines.join('\n'));

      // An item with a picture gets it beside the text; without one the text
      // uses the full width rather than leaving a gap where an image failed.
      const withImage = withThumbnail(lines.join('\n'), item.imageUrl);
      if (withImage instanceof SectionBuilder) container.addSectionComponents(withImage);
      else container.addTextDisplayComponents(body);
    }

    if (feedItems.length > ITEMS_PER_CARD) {
      container.addTextDisplayComponents(
        caption(`and ${feedItems.length - ITEMS_PER_CARD} more from this feed`),
      );
    }

    blocks.push(container);
  }

  return blocks;
}

/**
 * Sends a digest as a DM.
 *
 * Throws when the DM is refused, which is the signal the scheduler uses to
 * pause the subscription rather than retry forever.
 */
export async function deliverDigest(user: User, items: DeliverableItem[]): Promise<void> {
  // Five containers is a comfortable message; more is a wall. The rest stay
  // undelivered and lead the next digest.
  const blocks = digestBlocks(items, 'New in your feeds').slice(0, 6);
  // v2Update rather than v2: a DM is never ephemeral, and the Ephemeral flag
  // is rejected outright on a message create.
  await user.send(v2Update(blocks));
}
