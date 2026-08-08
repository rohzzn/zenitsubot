import type { Client, ChatInputCommandInteraction } from 'discord.js';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildPremiumTier,
  MessageFlags,
} from 'discord.js';
import {
  card,
  paragraph,
  divider,
  caption,
  facts,
  gallery,
  // Editing a deferred reply inherits its ephemerality, so the payload must
  // not carry the Ephemeral flag — v2Update is the variant that omits it.
  v2Update,
  type Block,
} from '../../../utils/layout.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { UserError } from '../../../utils/errors.js';
import { fetchAttachment, refetchImage } from '../../../utils/attachment.js';
import {
  compress,
  formatBytes,
  formatInfo,
  inspectImage,
  readExif,
  sizeDelta,
  stripMetadata,
  transform,
  DISCORD_UPLOAD_LIMIT,
  type ImageFacts,
  type OutputFormat,
  type TransformResult,
} from '../../../services/image.js';
import {
  attachState,
  componentId,
  registerComponentHandler,
  type ComponentHandler,
} from '../../../listeners/componentRouter.js';

/** Anything this big is refused before it is downloaded, let alone decoded. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The shared result card.
 *
 * Every one of these commands answers the same question — what did you do to
 * my image — so they answer it the same way: the result visible immediately,
 * then before and after side by side, then what it cost.
 */
function resultCard(options: {
  title: string;
  before: ImageFacts;
  after: ImageFacts;
  filename: string;
  notes?: string[];
  accent?: number;
}): Block[] {
  const { before, after } = options;

  const container = card(options.accent ?? ZENITSU_THEME.PRIMARY).addTextDisplayComponents(
    paragraph(`## ${options.title}`),
  );

  // The image itself, before any numbers about it. A gallery rather than a
  // thumbnail so it opens full size, and attachment:// resolves to the file
  // travelling with this same message.
  const preview = gallery([`attachment://${options.filename}`]);
  if (preview) container.addMediaGalleryComponents(preview);

  container.addSeparatorComponents(divider());

  const dimensionsChanged = before.width !== after.width || before.height !== after.height;

  container.addTextDisplayComponents(
    paragraph(
      facts([
        [
          'Format',
          before.format === after.format
            ? after.format.toUpperCase()
            : `${before.format.toUpperCase()} -> ${after.format.toUpperCase()}`,
        ],
        [
          'Size',
          dimensionsChanged
            ? `${before.width}x${before.height} -> ${after.width}x${after.height}`
            : `${after.width}x${after.height}`,
        ],
        [
          'File',
          before.bytes === after.bytes
            ? formatBytes(after.bytes)
            : `${formatBytes(before.bytes)} -> ${formatBytes(after.bytes)}  (${sizeDelta(before.bytes, after.bytes)})`,
        ],
        ['Transparency', after.hasAlpha ? 'kept' : before.hasAlpha ? 'flattened' : '-'],
        ['Frames', after.frames > 1 ? `${after.frames} (animated)` : '-'],
      ]),
    ),
  );

  if (options.notes?.length) {
    container.addTextDisplayComponents(caption(options.notes.join(' · ')));
  }

  return [container];
}

/**
 * Discord's per-message upload ceiling, which rises with the guild's boost
 * tier. Derived rather than read off the guild: discord.js does not expose it.
 */
function uploadLimit(interaction: ChatInputCommandInteraction): number {
  switch (interaction.guild?.premiumTier) {
    case GuildPremiumTier.Tier3:
      return 100 * 1024 * 1024;
    case GuildPremiumTier.Tier2:
      return 50 * 1024 * 1024;
    default:
      return DISCORD_UPLOAD_LIMIT;
  }
}

/** Sending a result larger than the channel allows fails the whole reply. */
function guardUploadSize(result: TransformResult, limit: number): void {
  if (result.data.length > limit) {
    throw new UserError(
      `The result is ${formatBytes(result.data.length)}, over this server's ${formatBytes(limit)} upload limit. ` +
        `Try \`/compress\` instead, or a smaller size.`,
    );
  }
}

// ------------------------------------------------------------------- convert

export const convert = {
  data: { name: 'convert' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const attachment = interaction.options.getAttachment('image', true);
    await interaction.deferReply();

    const source = await fetchAttachment(attachment, MAX_SOURCE_BYTES);
    const before = await inspectImage(source.data);

    const format = interaction.options.getString('format') as OutputFormat | null;
    const spec = formatInfo(format ?? (before.format as OutputFormat)) ?? formatInfo('png');

    const result = await transform(source, {
      format: format ?? undefined,
      quality: interaction.options.getInteger('quality') ?? undefined,
      width: interaction.options.getInteger('width') ?? undefined,
      height: interaction.options.getInteger('height') ?? undefined,
      scale: interaction.options.getInteger('scale') ?? undefined,
      fit:
        (interaction.options.getString('fit') as 'cover' | 'contain' | 'fill' | 'inside') ??
        undefined,
      background: interaction.options.getString('background') ?? undefined,
      rotate: interaction.options.getInteger('rotate') ?? undefined,
      flip:
        (interaction.options.getString('flip') as 'horizontal' | 'vertical' | 'both') ?? undefined,
      grayscale: interaction.options.getBoolean('grayscale') ?? undefined,
      keepMetadata: interaction.options.getBoolean('keep-metadata') ?? undefined,
    });

    guardUploadSize(result, uploadLimit(interaction));

    const notes: string[] = [];
    if (before.hasAlpha && !spec.alpha) {
      notes.push(
        `${spec.label} has no transparency, so it was flattened onto ${interaction.options.getString('background') ?? '#ffffff'}`,
      );
    }
    if (before.frames > 1 && result.facts.frames === 1) {
      notes.push(`${spec.label} does not animate, so only the first frame was kept`);
    }
    if (!interaction.options.getBoolean('keep-metadata')) {
      notes.push('Metadata stripped');
    }

    await interaction.editReply({
      ...v2Update(
        resultCard({
          title: `Converted to ${spec.label}`,
          before,
          after: result.facts,
          filename: result.filename,
          notes,
        }),
      ),
      files: [new AttachmentBuilder(result.data, { name: result.filename })],
    });
  },
};

// ------------------------------------------------------------------ compress

const TARGET_PRESETS: Record<string, number> = {
  discord: DISCORD_UPLOAD_LIMIT,
  '8mb': 8 * 1024 * 1024,
  '5mb': 5 * 1024 * 1024,
  '2mb': 2 * 1024 * 1024,
  '1mb': 1024 * 1024,
  '500kb': 500 * 1024,
  '256kb': 256 * 1024,
};

export const compressCommand = {
  data: { name: 'compress' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const attachment = interaction.options.getAttachment('image', true);
    await interaction.deferReply();

    const source = await fetchAttachment(attachment, MAX_SOURCE_BYTES);
    const before = await inspectImage(source.data);

    const preset = interaction.options.getString('target') ?? 'discord';
    const custom = interaction.options.getInteger('target-kb');
    const target = custom ? custom * 1024 : (TARGET_PRESETS[preset] ?? DISCORD_UPLOAD_LIMIT);

    if (before.bytes <= target) {
      // Re-encoding something already under budget makes it worse, not better.
      await interaction.editReply(
        `That image is already ${formatBytes(before.bytes)}, under the ${formatBytes(target)} target. Nothing to do.`,
      );
      return;
    }

    const result = await compress(source, target, {
      format: (interaction.options.getString('format') as OutputFormat | null) ?? undefined,
      allowResize: interaction.options.getBoolean('allow-resize') ?? true,
    });

    const notes = [`${result.attempts} encode${result.attempts === 1 ? '' : 's'}`];
    if (result.scale !== 100) notes.push(`scaled to ${result.scale}%`);
    notes.push(`quality ${result.quality}`);

    if (result.missedTarget) {
      notes.push('could not reach the target without destroying it');
    }

    await interaction.editReply({
      ...v2Update(
        resultCard({
          title: result.missedTarget
            ? `Compressed as far as it goes`
            : `Compressed under ${formatBytes(target)}`,
          before,
          after: result.facts,
          filename: result.filename,
          notes,
          accent: result.missedTarget ? ZENITSU_THEME.ERROR : ZENITSU_THEME.SUCCESS,
        }),
      ),
      files: [new AttachmentBuilder(result.data, { name: result.filename })],
    });
  },
};

// ---------------------------------------------------------------------- exif

const EXIF_KIND = 'exif';

interface ExifState {
  url: string;
  name: string;
}

/**
 * Stripping is a button rather than a flag.
 *
 * You do not know whether you want a clean copy until you have seen what is in
 * there, and the answer is usually driven by one line — the GPS coordinates.
 */
const exifHandler: ComponentHandler<ExifState> = {
  kind: EXIF_KIND,
  ttlMs: WEEK_MS,
  expiredMessage: 'This reading has expired. Run `/exif` again.',

  async handle({ interaction, action, state }) {
    if (action !== 'strip') return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const data = await refetchImage(state.url, state.name, MAX_SOURCE_BYTES);
    const cleaned = await stripMetadata({ data, name: state.name });
    const remaining = await readExif(cleaned.data);

    await interaction.editReply({
      content:
        `**${cleaned.filename}** — ${formatBytes(cleaned.data.length)}, ` +
        `${remaining.count === 0 ? 'no metadata remaining' : `${remaining.count} tags remaining`}.`,
      files: [new AttachmentBuilder(cleaned.data, { name: cleaned.filename })],
    });
  },
};

registerComponentHandler(exifHandler);

export const exif = {
  data: { name: 'exif' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const attachment = interaction.options.getAttachment('image', true);
    const priv = interaction.options.getBoolean('private') ?? true;

    // Private by default: metadata routinely contains where someone was and
    // what device they own, which is not a decision to make on their behalf.
    await interaction.deferReply(priv ? { flags: MessageFlags.Ephemeral } : {});

    const source = await fetchAttachment(attachment, MAX_SOURCE_BYTES);
    const image = await inspectImage(source.data);
    const report = await readExif(source.data);

    const container = card(report.gps ? ZENITSU_THEME.ERROR : ZENITSU_THEME.PRIMARY);

    container.addTextDisplayComponents(
      paragraph(
        `## ${attachment.name}\n${image.format.toUpperCase()} · ${image.width}x${image.height} · ${formatBytes(image.bytes)}`,
      ),
    );

    if (report.gps) {
      const { latitude, longitude } = report.gps;
      container.addSeparatorComponents(divider());
      container.addTextDisplayComponents(
        paragraph(
          `**This image says where it was taken.**\n` +
            `\`${latitude.toFixed(6)}, ${longitude.toFixed(6)}\` — ` +
            `[open in maps](https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude})`,
        ),
      );
    }

    if (report.count === 0) {
      container.addSeparatorComponents(divider());
      container.addTextDisplayComponents(
        paragraph(
          'No metadata found. Either it was never written, or something already stripped it — ' +
            'Discord removes EXIF from images uploaded through the app.',
        ),
      );
      await interaction.editReply(v2Update([container]));
      return;
    }

    for (const group of report.groups) {
      container.addSeparatorComponents(divider());
      container.addTextDisplayComponents(paragraph(`**${group.name}**\n${facts(group.entries)}`));
    }

    container.addTextDisplayComponents(caption(`${report.count} tags`));

    const blocks: Block[] = [
      container,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(componentId(EXIF_KIND, 'strip'))
          .setLabel('Download without metadata')
          .setStyle(report.gps ? ButtonStyle.Danger : ButtonStyle.Secondary),
      ),
    ];

    const message = await interaction.editReply(v2Update(blocks));
    await attachState(message.id, exifHandler, interaction.user.id, {
      url: attachment.url,
      name: attachment.name,
    });
  },
};
