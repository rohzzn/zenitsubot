import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import type { GuildMember } from 'discord.js';
import { logger } from './logger.js';

/**
 * The welcome image.
 *
 * An image rather than a message because that is what was asked for, and it is
 * the right call: a card with someone's avatar in it reads as a greeting where
 * a line of text reads as a log entry.
 *
 * Composed with sharp rather than a canvas library. node-canvas needs a native
 * build, which this machine cannot do — the Xcode licence is unaccepted — and
 * sharp is already a dependency for /convert. Text is drawn as SVG, which
 * libvips rasterises with the fonts installed in the image.
 */

const WIDTH = 1000;
const HEIGHT = 340;
const AVATAR = 180;
const AVATAR_X = 60;
const AVATAR_Y = (HEIGHT - AVATAR) / 2;

/** Text starts to the right of the avatar, with room to breathe. */
const TEXT_X = AVATAR_X + AVATAR + 48;

export interface WelcomeCardOptions {
  /** Shown large. Their display name in this server. */
  name: string;
  /** Shown small underneath, e.g. "@rohan". */
  handle?: string;
  avatarUrl: string;
  /** Their profile banner, used as the background when they have one. */
  bannerUrl?: string;
  /** Accent to fall back to when there is no banner. */
  accent?: number;
  /** "You are our 247th member". */
  memberCount?: number;
  guildName: string;
}

/** XML-escapes text before it goes into an SVG. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Trims to fit the card, since a long name would run off the edge. */
function fit(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;

  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** A circular mask, so the avatar is a circle rather than a rounded square. */
function circleMask(size: number): Buffer {
  return Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
}

/**
 * Builds the card.
 *
 * Everything is composited over a background that is either the member's own
 * banner, blurred and darkened so text stays readable, or a gradient built
 * from their accent colour.
 */
export async function renderWelcomeCard(options: WelcomeCardOptions): Promise<Buffer> {
  const accent = options.accent ?? 0x5865f2;
  const r = (accent >> 16) & 0xff;
  const g = (accent >> 8) & 0xff;
  const b = accent & 0xff;

  // ------------------------------------------------------------- background
  let background: Buffer;

  const banner = options.bannerUrl ? await fetchImage(options.bannerUrl) : null;

  if (banner) {
    // Blurred and dimmed: a banner is a photograph and white text over an
    // unmodified one is frequently unreadable.
    background = await sharp(banner)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
      .blur(12)
      .modulate({ brightness: 0.45 })
      .toBuffer();
  } else {
    const gradient = `
      <svg width="${WIDTH}" height="${HEIGHT}">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="rgb(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)})"/>
            <stop offset="100%" stop-color="rgb(${Math.round(r * 0.16)},${Math.round(g * 0.16)},${Math.round(b * 0.2)})"/>
          </linearGradient>
        </defs>
        <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      </svg>`;

    background = await sharp(Buffer.from(gradient)).png().toBuffer();
  }

  // ----------------------------------------------------------------- avatar
  const avatarData = await fetchImage(options.avatarUrl);

  const avatar = avatarData
    ? await sharp(avatarData)
        .resize(AVATAR, AVATAR, { fit: 'cover' })
        .composite([{ input: circleMask(AVATAR), blend: 'dest-in' }])
        .png()
        .toBuffer()
    : null;

  // A ring behind the avatar, which is what separates it from a busy banner.
  const ring = Buffer.from(
    `<svg width="${AVATAR + 12}" height="${AVATAR + 12}">
       <circle cx="${(AVATAR + 12) / 2}" cy="${(AVATAR + 12) / 2}" r="${AVATAR / 2 + 4}"
               fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="6"/>
     </svg>`,
  );

  // ------------------------------------------------------------------- text
  const name = escapeXml(fit(options.name, 20));
  const handle = options.handle ? escapeXml(fit(options.handle, 26)) : '';
  const guild = escapeXml(fit(options.guildName, 32));
  const position = options.memberCount ? `${ordinal(options.memberCount)} member` : '';

  const text = `
    <svg width="${WIDTH}" height="${HEIGHT}">
      <style>
        /* DejaVu is what the image ships; the rest are fallbacks for names
           the Latin face has no glyphs for. */
        .stack { font-family: 'DejaVu Sans', 'Noto Sans', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Color Emoji', sans-serif; }
        .kicker { font-size: 26px; fill: rgba(255,255,255,0.72); letter-spacing: 3px; }
        .name   { font-size: 62px; fill: #ffffff; font-weight: bold; }
        .handle { font-size: 27px; fill: rgba(255,255,255,0.62); }
        .meta   { font-size: 24px; fill: rgba(255,255,255,0.80); }
      </style>
      <g class="stack">
        <text x="${TEXT_X}" y="104" class="kicker">WELCOME TO ${guild.toUpperCase()}</text>
        <text x="${TEXT_X}" y="176" class="name">${name}</text>
        ${handle ? `<text x="${TEXT_X}" y="214" class="handle">${handle}</text>` : ''}
        ${position ? `<text x="${TEXT_X}" y="264" class="meta">You are our ${position}</text>` : ''}
      </g>
    </svg>`;

  // A thin accent bar down the left edge, which ties the card to the colour
  // even when a banner has replaced the gradient.
  const bar = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}">
       <rect x="0" y="0" width="10" height="${HEIGHT}" fill="rgb(${r},${g},${b})"/>
     </svg>`,
  );

  const layers: OverlayOptions[] = [{ input: bar, top: 0, left: 0 }];

  if (avatar) {
    layers.push(
      { input: ring, top: AVATAR_Y - 6, left: AVATAR_X - 6 },
      { input: avatar, top: AVATAR_Y, left: AVATAR_X },
    );
  }

  layers.push({ input: Buffer.from(text), top: 0, left: 0 });

  return sharp(background).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

/** Builds the card for a member who just joined. */
export async function welcomeCardFor(member: GuildMember): Promise<Buffer | null> {
  try {
    // Fetched because a banner is not on the cached user object; without this
    // every card falls back to the gradient.
    const user = await member.user.fetch().catch(() => member.user);

    return await renderWelcomeCard({
      name: member.displayName,
      handle: `@${member.user.username}`,
      avatarUrl: member.displayAvatarURL({ size: 256, extension: 'png' }),
      bannerUrl: user.bannerURL({ size: 1024, extension: 'png' }) ?? undefined,
      accent: user.accentColor ?? member.displayColor ?? undefined,
      memberCount: member.guild.memberCount,
      guildName: member.guild.name,
    });
  } catch (err) {
    logger.warn({ err, user: member.id }, 'Could not render welcome card');
    return null;
  }
}
