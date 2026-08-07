import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import { ZENITSU_THEME } from './constants.js';
import { usableImage } from './ui.js';

/**
 * Components V2 layout helpers.
 *
 * V2 replaces the embed with a container that has real structure: text beside
 * a thumbnail, image grids, and separators, none of which an embed can express.
 *
 * One hard rule comes with it — a message using these may not also carry
 * `content` or `embeds`. Everything visible has to be a component, so these
 * helpers always produce a complete message payload rather than a fragment.
 */

export const V2_FLAG = MessageFlags.IsComponentsV2;

export type Block =
  | ContainerBuilder
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>
  | TextDisplayBuilder;

/**
 * Markdown paragraph. Headings use `## ` and render larger than bold text.
 *
 * Empty content is rejected by Discord, and an empty string is easy to produce
 * by accident from a list that filtered down to nothing, so it is substituted
 * rather than allowed to fail the whole message.
 */
export function paragraph(markdown: string): TextDisplayBuilder {
  const content = markdown.trim() || '-';
  return new TextDisplayBuilder().setContent(content.slice(0, 4000));
}

export function divider(large = false): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/** Invisible spacing, for grouping without drawing a line. */
export function gap(large = false): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(false)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/**
 * Text with an image to its right, or plain text when there is no usable image.
 *
 * A section is invalid without an accessory, so returning one with the
 * thumbnail omitted would fail the whole message. Sites that only publish an
 * .ico favicon hit this constantly, hence the plain-text fallback.
 */
export function withThumbnail(
  markdown: string,
  imageUrl?: string | null,
): SectionBuilder | TextDisplayBuilder {
  const safe = usableImage(imageUrl);
  if (!safe) return paragraph(markdown);

  return new SectionBuilder()
    .addTextDisplayComponents(paragraph(markdown))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(safe));
}

/** Text with a button to its right, for a row that is its own action. */
export function withButton(markdown: string, button: ButtonBuilder): SectionBuilder {
  return new SectionBuilder()
    .addTextDisplayComponents(paragraph(markdown))
    .setButtonAccessory(button);
}

/**
 * An image grid. Discord lays out 1-10 items automatically, so several
 * screenshots read as a contact sheet rather than a paging exercise.
 */
export function gallery(urls: Array<string | null | undefined>): MediaGalleryBuilder | null {
  const items = urls
    .map((url) => usableImage(url))
    .filter((url): url is string => Boolean(url))
    .slice(0, 10)
    .map((url) => new MediaGalleryItemBuilder().setURL(url));

  return items.length ? new MediaGalleryBuilder().addItems(...items) : null;
}

/** A card with a coloured accent bar. */
export function card(accent: number = ZENITSU_THEME.PRIMARY): ContainerBuilder {
  return new ContainerBuilder().setAccentColor(accent);
}

/**
 * Key/value pairs as aligned monospace, since V2 has no field grid.
 * Alignment is what makes a block of facts scannable rather than a wall.
 */
export function facts(pairs: Array<[string, string]>): string {
  const rows = pairs.filter(([, value]) => value && value !== '-');
  // Callers interpolate this straight into a paragraph, so an empty string
  // here would produce empty content and fail validation.
  if (rows.length === 0) return '-';

  const width = Math.max(...rows.map(([label]) => label.length));
  const body = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n');

  return `\`\`\`\n${body}\n\`\`\``;
}

/** Subdued caption text; the V2 equivalent of an embed footer. */
export function caption(markdown: string): TextDisplayBuilder {
  return paragraph(`-# ${markdown.slice(0, 300)}`);
}

/**
 * Wraps blocks into a payload that satisfies the V2 flag rules.
 *
 * Ephemeral is expressed as a flag rather than the `ephemeral` boolean: the
 * two cannot be mixed once IsComponentsV2 is set.
 */
export function v2(components: Block[], options: { ephemeral?: boolean } = {}) {
  const flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral = options.ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;

  return { flags, components };
}

/**
 * Payload for editing an existing message.
 *
 * Separate from v2() because an edit inherits the original's ephemerality and
 * rejects the Ephemeral flag outright.
 */
export function v2Update(components: Block[]) {
  // Annotated rather than inferred: TypeScript widens the enum member to
  // MessageFlags, which the update overloads reject.
  const flags: MessageFlags.IsComponentsV2 = MessageFlags.IsComponentsV2;
  return { flags, components };
}
