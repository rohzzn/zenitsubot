import sharp from 'sharp';
import type { Sharp } from 'sharp';
import exifr from 'exifr';
import { UserError } from '../utils/errors.js';
import { logger } from './logger.js';

/**
 * Image processing, on sharp rather than Jimp.
 *
 * Jimp is already a dependency and handles the palette strip in /inspect, but
 * it cannot encode WebP or AVIF — verified against 1.6.1, which rejects both
 * MIME types outright. Those are the two formats anyone converting an image in
 * 2026 actually wants, so the work that needs them uses libvips instead.
 *
 * Everything here is deliberately bounded: images arrive from Discord, are
 * decoded in-process, and a malicious or merely enormous one must not be able
 * to exhaust memory.
 */

/** Discord's own ceiling for a non-boosted upload. */
export const DISCORD_UPLOAD_LIMIT = 10 * 1024 * 1024;

/** Refuse to decode anything larger; a decoded bitmap dwarfs its encoded size. */
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** 100MP is far past anything real and well short of a decompression bomb. */
const MAX_PIXELS = 100_000_000;
const MAX_DIMENSION = 16_000;

export type OutputFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff';

export const FORMATS: ReadonlyArray<{
  value: OutputFormat;
  label: string;
  /** File extension, which is not always the format name. */
  ext: string;
  lossy: boolean;
  alpha: boolean;
  blurb: string;
}> = [
  {
    value: 'webp',
    label: 'WebP',
    ext: 'webp',
    lossy: true,
    alpha: true,
    blurb: 'Best all-round: small, keeps transparency',
  },
  {
    value: 'avif',
    label: 'AVIF',
    ext: 'avif',
    lossy: true,
    alpha: true,
    blurb: 'Smallest, slower to encode',
  },
  {
    value: 'jpeg',
    label: 'JPEG',
    ext: 'jpg',
    lossy: true,
    alpha: false,
    blurb: 'Universal, no transparency',
  },
  {
    value: 'png',
    label: 'PNG',
    ext: 'png',
    lossy: false,
    alpha: true,
    blurb: 'Lossless, large',
  },
  {
    value: 'tiff',
    label: 'TIFF',
    ext: 'tiff',
    lossy: false,
    alpha: true,
    blurb: 'Lossless, for print and archival',
  },
  { value: 'gif', label: 'GIF', ext: 'gif', lossy: false, alpha: true, blurb: '256 colours' },
];

export function formatInfo(format: OutputFormat) {
  return FORMATS.find((f) => f.value === format)!;
}

export interface SourceImage {
  data: Buffer;
  name: string;
  /** As Discord reported it, which is not necessarily what the bytes are. */
  declaredType?: string;
}

export interface ImageFacts {
  format: string;
  width: number;
  height: number;
  bytes: number;
  /** True when the image has an alpha channel carrying actual transparency. */
  hasAlpha: boolean;
  /** Frame count; more than one means it is animated. */
  frames: number;
  space?: string;
}

export interface TransformOptions {
  format?: OutputFormat;
  /** 1-100. Ignored by the lossless formats. */
  quality?: number;
  width?: number;
  height?: number;
  /** Percentage of the original, applied when no explicit size is given. */
  scale?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside';
  /** Flattens transparency onto this colour. Required for JPEG. */
  background?: string;
  rotate?: number;
  flip?: 'horizontal' | 'vertical' | 'both';
  grayscale?: boolean;
  /** Strips EXIF, ICC and everything else. sharp does this unless told not to. */
  keepMetadata?: boolean;
}

export interface TransformResult {
  data: Buffer;
  facts: ImageFacts;
  filename: string;
}

/** Guards decoding. Applied to every pipeline built here. */
function open(data: Buffer, animated = false) {
  if (data.length > MAX_INPUT_BYTES) {
    throw new UserError(
      `That image is ${formatBytes(data.length)}. The limit is ${formatBytes(MAX_INPUT_BYTES)}.`,
    );
  }

  return sharp(data, {
    limitInputPixels: MAX_PIXELS,
    // Reading every frame is what keeps an animated source animated; it is off
    // by default and silently flattens a GIF to its first frame.
    animated,
    failOn: 'error',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Difference between two sizes, phrased the way a person would say it. */
export function sizeDelta(before: number, after: number): string {
  if (after === before) return 'no change';
  const percent = Math.round((Math.abs(after - before) / before) * 100);
  return after < before ? `${percent}% smaller` : `${percent}% larger`;
}

export async function inspectImage(data: Buffer): Promise<ImageFacts> {
  let meta;
  try {
    meta = await open(data).metadata();
  } catch (err) {
    logger.debug({ err }, 'Image metadata read failed');
    throw new UserError('That file could not be read as an image.');
  }

  if (!meta.width || !meta.height) {
    throw new UserError('That file could not be read as an image.');
  }

  return {
    // AVIF is an HEIF container, and libvips reports the container. Left as-is
    // it surfaces as "converted to HEIF" in the UI, and — worse — stripMetadata
    // would not recognise it and would quietly re-encode a photo to PNG.
    format:
      meta.format === 'heif' && meta.compression === 'av1' ? 'avif' : (meta.format ?? 'unknown'),
    width: meta.width,
    height: meta.height,
    bytes: data.length,
    hasAlpha: Boolean(meta.hasAlpha),
    frames: meta.pages ?? 1,
    space: meta.space,
  };
}

function parseColour(value: string): { r: number; g: number; b: number; alpha: number } {
  const hex = value.trim().replace(/^#/, '');

  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) {
    throw new UserError(`"${value}" is not a hex colour. Use something like #ffffff.`);
  }

  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    alpha: 1,
  };
}

function encode(pipeline: Sharp, format: OutputFormat, quality: number): Sharp {
  switch (format) {
    case 'jpeg':
      // mozjpeg is a straight improvement at the same quality number.
      return pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
    case 'webp':
      return pipeline.webp({ quality, effort: 4 });
    case 'avif':
      // effort 4 rather than the default 4-9 sweet spot: AVIF encoding is slow
      // and a Discord interaction has to finish inside a token's lifetime.
      return pipeline.avif({ quality, effort: 3 });
    case 'png':
      // PNG is lossless, so quality drives palette quantisation instead.
      return pipeline.png({ compressionLevel: 9, palette: quality < 100 });
    case 'tiff':
      return pipeline.tiff({ compression: 'lzw' });
    case 'gif':
      return pipeline.gif();
  }
}

/**
 * The single transform every command goes through.
 *
 * Order matters and is fixed here rather than left to callers: rotate before
 * resize (so the requested width applies to the final orientation), flatten
 * before encoding (so a JPEG never inherits a black background from discarded
 * alpha), and metadata stripped last.
 */
export async function transform(
  source: SourceImage,
  options: TransformOptions,
): Promise<TransformResult> {
  const original = await inspectImage(source.data);

  const format = options.format ?? (original.format as OutputFormat) ?? 'png';
  const spec = formatInfo(format) ?? formatInfo('png');
  const quality = Math.min(Math.max(options.quality ?? 82, 1), 100);

  // Animation only survives if both ends support it and nothing needs a flatten.
  const animated = original.frames > 1 && (format === 'gif' || format === 'webp');

  let pipeline = open(source.data, animated);

  if (options.rotate) pipeline = pipeline.rotate(options.rotate);
  // With no angle, rotate() applies the EXIF orientation tag — which matters
  // because stripping metadata would otherwise leave a phone photo sideways.
  else pipeline = pipeline.rotate();

  if (options.flip === 'horizontal' || options.flip === 'both') pipeline = pipeline.flop();
  if (options.flip === 'vertical' || options.flip === 'both') pipeline = pipeline.flip();

  const target = resolveSize(original, options);
  if (target) {
    pipeline = pipeline.resize({
      width: target.width,
      height: target.height,
      fit: options.fit ?? 'inside',
      withoutEnlargement: false,
      background: options.background ? parseColour(options.background) : undefined,
    });
  }

  if (options.grayscale) pipeline = pipeline.grayscale();

  // A format with no alpha channel needs the transparency put somewhere, or
  // libvips drops it to black and the result looks broken rather than flattened.
  if (!spec.alpha && original.hasAlpha) {
    pipeline = pipeline.flatten({ background: parseColour(options.background ?? '#ffffff') });
  } else if (options.background) {
    pipeline = pipeline.flatten({ background: parseColour(options.background) });
  }

  if (options.keepMetadata) pipeline = pipeline.withMetadata();

  const data = await encode(pipeline, format, quality).toBuffer();

  return {
    data,
    facts: await inspectImage(data),
    filename: `${baseName(source.name)}.${spec.ext}`,
  };
}

function resolveSize(
  original: ImageFacts,
  options: TransformOptions,
): { width?: number; height?: number } | null {
  if (options.width || options.height) {
    for (const value of [options.width, options.height]) {
      if (value !== undefined && (value < 1 || value > MAX_DIMENSION)) {
        throw new UserError(`Dimensions must be between 1 and ${MAX_DIMENSION.toLocaleString()}.`);
      }
    }
    return { width: options.width, height: options.height };
  }

  if (options.scale && options.scale !== 100) {
    if (options.scale < 1 || options.scale > 400) {
      throw new UserError('Scale must be between 1 and 400 percent.');
    }
    return {
      width: Math.max(1, Math.round((original.width * options.scale) / 100)),
      height: Math.max(1, Math.round((original.height * options.scale) / 100)),
    };
  }

  return null;
}

export function baseName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, '');
  // Discord rejects some characters in attachment names, and a name taken from
  // a remote URL is not trustworthy input.
  return withoutExtension.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image';
}

export interface CompressResult extends TransformResult {
  /** Quality the search settled on. */
  quality: number;
  /** Scale applied when quality alone could not reach the target. */
  scale: number;
  attempts: number;
  /** True when even the most aggressive settings missed the target. */
  missedTarget: boolean;
}

/**
 * Shrinks an image to fit a byte budget.
 *
 * Binary search on quality rather than a fixed ladder: the size/quality curve
 * differs wildly between a photo and a screenshot, so a fixed set of steps
 * either overshoots on one or wastes encodes on the other. Ten encodes is
 * already generous; the search converges in six or seven.
 *
 * Falls back to scaling down only when the lowest useful quality still misses,
 * because losing pixels is worse than losing precision and should be a last
 * resort rather than a first move.
 */
export async function compress(
  source: SourceImage,
  targetBytes: number,
  options: { format?: OutputFormat; minQuality?: number; allowResize?: boolean } = {},
): Promise<CompressResult> {
  const original = await inspectImage(source.data);
  const format = options.format ?? preferredCompressionFormat(original);
  const minQuality = options.minQuality ?? 40;

  /**
   * The search maximises quality subject to the cap, which is only the right
   * goal when the source is over it. Asked to fit a 9.9 MB file under 10 MB it
   * would happily return a *larger* file at quality 95, having satisfied the
   * constraint it was given.
   *
   * Compression means smaller than what you have, so the cap is tightened to
   * guarantee a real reduction. An explicit target below that still wins.
   */
  const target = Math.min(targetBytes, Math.floor(original.bytes * 0.85));

  let attempts = 0;
  let best: TransformResult | null = null;
  let bestQuality = 0;

  let low = minQuality;
  let high = 95;

  while (low <= high && attempts < 10) {
    const quality = Math.floor((low + high) / 2);
    const candidate = await transform(source, { format, quality });
    attempts++;

    if (candidate.data.length <= target) {
      // Keep the highest quality that fits, then try to do better.
      best = candidate;
      bestQuality = quality;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }

  if (best) {
    return { ...best, quality: bestQuality, scale: 100, attempts, missedTarget: false };
  }

  if (options.allowResize === false) {
    const floor = await transform(source, { format, quality: minQuality });
    return {
      ...floor,
      quality: minQuality,
      scale: 100,
      attempts: attempts + 1,
      missedTarget: floor.data.length > target,
    };
  }

  // Quality alone was not enough. Step the dimensions down; each step is a
  // ~30% area reduction, which is roughly a linear drop in encoded size.
  for (const scale of [80, 65, 50, 40, 30, 20]) {
    const candidate = await transform(source, { format, quality: minQuality + 10, scale });
    attempts++;

    if (candidate.data.length <= target) {
      return { ...candidate, quality: minQuality + 10, scale, attempts, missedTarget: false };
    }
    best = candidate;
    bestQuality = minQuality + 10;
  }

  return {
    ...best!,
    quality: bestQuality,
    scale: 20,
    attempts,
    missedTarget: true,
  };
}

/** Photographs and screenshots compress best under different codecs. */
function preferredCompressionFormat(facts: ImageFacts): OutputFormat {
  if (facts.frames > 1) return 'webp';
  // WebP beats JPEG on both, and unlike AVIF it encodes fast enough for an
  // interaction that also has to survive a binary search.
  return 'webp';
}

export interface ExifGroup {
  name: string;
  entries: Array<[string, string]>;
}

export interface ExifReport {
  groups: ExifGroup[];
  /** Present when the image carries coordinates. */
  gps?: { latitude: number; longitude: number };
  /** Total tags found across every group. */
  count: number;
}

const GROUPS: ReadonlyArray<{ name: string; keys: string[] }> = [
  {
    name: 'Camera',
    keys: ['Make', 'Model', 'LensModel', 'LensMake', 'SerialNumber', 'BodySerialNumber'],
  },
  {
    name: 'Exposure',
    keys: [
      'FNumber',
      'ExposureTime',
      'ISO',
      'FocalLength',
      'FocalLengthIn35mmFormat',
      'ExposureProgram',
      'ExposureCompensation',
      'MeteringMode',
      'Flash',
      'WhiteBalance',
    ],
  },
  {
    // Dimensions are deliberately absent: they are on the card's header line
    // already, and repeating them pads the reading with what you can see.
    name: 'Image',
    keys: ['Orientation', 'ColorSpace', 'XResolution', 'YResolution', 'ResolutionUnit'],
  },
  {
    name: 'Timestamps',
    keys: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTime'],
  },
  {
    name: 'Software',
    keys: ['Software', 'HostComputer', 'ProcessingSoftware', 'Artist', 'Copyright'],
  },
  {
    name: 'Description',
    keys: ['ImageDescription', 'UserComment', 'Headline', 'Caption', 'Keywords', 'Creator'],
  },
];

/**
 * Tags that describe the file's own structure rather than anything about how
 * it was made.
 *
 * exifr decodes a PNG's header into these, so a freshly generated PNG with no
 * metadata whatsoever comes back with seven "tags". Listing them makes an
 * image that carries nothing look like it carries something, which is the
 * opposite of what /exif is for — and the header line of the card already says
 * the dimensions.
 */
const STRUCTURAL = new Set([
  'ImageWidth',
  'ImageHeight',
  'BitDepth',
  'ColorType',
  'Compression',
  'Filter',
  'Interlace',
  'ExifImageWidth',
  'ExifImageHeight',
]);

function present(value: unknown, key: string): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date)
    return value
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, ' UTC');
  if (Array.isArray(value)) return value.slice(0, 8).join(', ') || null;
  if (typeof value === 'object') return null;

  if (typeof value === 'number') {
    // The tags people read as fractions, written the way a camera would.
    if (key === 'ExposureTime' && value > 0 && value < 1) return `1/${Math.round(1 / value)}s`;
    if (key === 'ExposureTime') return `${value}s`;
    if (key === 'FNumber') return `f/${value}`;
    if (key === 'FocalLength' || key === 'FocalLengthIn35mmFormat') return `${value}mm`;
    if (key === 'ISO') return `ISO ${value}`;
    return String(Number.isInteger(value) ? value : Number(value.toFixed(4)));
  }

  const text = String(value).trim();
  return text.length ? text.slice(0, 120) : null;
}

/** Splits a camelCase tag name into words, which is how they read in every tool. */
function label(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

export async function readExif(data: Buffer): Promise<ExifReport> {
  let tags: Record<string, unknown> | undefined;

  try {
    tags = (await exifr.parse(data, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      interop: true,
      translateValues: true,
      reviveValues: true,
    })) as Record<string, unknown> | undefined;
  } catch (err) {
    logger.debug({ err }, 'EXIF parse failed');
    tags = undefined;
  }

  if (!tags) return { groups: [], count: 0 };

  const claimed = new Set<string>();
  const groups: ExifGroup[] = [];

  for (const group of GROUPS) {
    const entries: Array<[string, string]> = [];

    for (const key of group.keys) {
      const rendered = present(tags[key], key);
      if (rendered === null) continue;
      entries.push([label(key), rendered]);
      claimed.add(key);
    }

    if (entries.length) groups.push({ name: group.name, entries });
  }

  // Anything the groups did not claim, so a tag is never silently dropped.
  const rest: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(tags)) {
    if (claimed.has(key)) continue;
    if (/^(latitude|longitude|GPS)/i.test(key)) continue;
    if (STRUCTURAL.has(key)) continue;
    const rendered = present(value, key);
    if (rendered === null) continue;
    rest.push([label(key), rendered]);
  }

  if (rest.length) groups.push({ name: 'Other', entries: rest.slice(0, 25) });

  const latitude = tags['latitude'];
  const longitude = tags['longitude'];
  const gps =
    typeof latitude === 'number' && typeof longitude === 'number'
      ? { latitude, longitude }
      : undefined;

  return {
    groups,
    gps,
    count: groups.reduce((sum, group) => sum + group.entries.length, 0),
  };
}

/**
 * Re-encodes without metadata.
 *
 * sharp drops everything unless withMetadata() is called, so this is a plain
 * round trip. The format is preserved — the point is to remove the tags, not
 * to change what the file is.
 */
export async function stripMetadata(source: SourceImage): Promise<TransformResult> {
  const facts = await inspectImage(source.data);
  const animated = facts.frames > 1;

  const format = (
    ['png', 'jpeg', 'webp', 'avif', 'gif', 'tiff'].includes(facts.format) ? facts.format : 'png'
  ) as OutputFormat;

  // Quality 95 rather than a default: this is a privacy operation, and losing
  // visible quality as a side effect of it would be a surprise.
  const data = await encode(open(source.data, animated), format, 95).toBuffer();

  return {
    data,
    facts: await inspectImage(data),
    filename: `${baseName(source.name)}-clean.${formatInfo(format).ext}`,
  };
}
