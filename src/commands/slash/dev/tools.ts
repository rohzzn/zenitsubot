import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

// ------------------------------------------------------------- timestamp

const STYLES = [
  { style: 't', label: 'Short time' },
  { style: 'T', label: 'Long time' },
  { style: 'd', label: 'Short date' },
  { style: 'D', label: 'Long date' },
  { style: 'f', label: 'Short date/time' },
  { style: 'F', label: 'Long date/time' },
  { style: 'R', label: 'Relative' },
] as const;

const RELATIVE_PATTERN = /^([+-]?\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|week|weeks)$/i;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  m: 60,
  min: 60,
  mins: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  w: 604800,
  week: 604800,
  weeks: 604800,
};

/** Accepts "now", a relative offset like "+30m", a Unix seconds value, or a date. */
function resolveInstant(input: string | null): Date | null {
  if (!input || input.trim().toLowerCase() === 'now') return new Date();

  const value = input.trim();

  const relative = value.match(RELATIVE_PATTERN);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = UNIT_SECONDS[relative[2]!.toLowerCase()];
    if (unit) return new Date(Date.now() + amount * unit * 1000);
  }

  // A bare 10-digit number is Unix seconds; 13 digits is milliseconds.
  if (/^\d{10}$/.test(value)) return new Date(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return new Date(Number(value));

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const timestamp = {
  data: { name: 'timestamp' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const input = interaction.options.getString('when');
    const instant = resolveInstant(input);

    if (!instant) {
      await interaction.reply({
        content:
          'Could not read that time. Try `now`, a relative offset like `+30m` or `-2d`, ' +
          'a Unix timestamp, or a date like `2026-12-25 18:00`.',
        ephemeral: true,
      });
      return;
    }

    const seconds = Math.floor(instant.getTime() / 1000);

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('Discord timestamps')
      .setDescription(
        STYLES.map(
          ({ style, label }) =>
            `**${label}**\n\`<t:${seconds}:${style}>\` renders as <t:${seconds}:${style}>`,
        ).join('\n\n'),
      )
      .setFooter({ text: "Copy the code — it renders in each viewer's own timezone" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

// ----------------------------------------------------------- HTTP status

interface StatusInfo {
  name: string;
  description: string;
}

const HTTP_STATUS: Record<number, StatusInfo> = {
  100: { name: 'Continue', description: 'The client should continue with its request.' },
  101: {
    name: 'Switching Protocols',
    description: 'The server is switching protocols, as requested.',
  },
  200: { name: 'OK', description: 'The request succeeded.' },
  201: { name: 'Created', description: 'The request succeeded and created a new resource.' },
  202: { name: 'Accepted', description: 'Accepted for processing, but not yet completed.' },
  204: { name: 'No Content', description: 'Succeeded, and there is no body to return.' },
  206: {
    name: 'Partial Content',
    description: 'Returning part of the resource, as requested by Range.',
  },
  301: { name: 'Moved Permanently', description: 'The resource has a new permanent URL.' },
  302: { name: 'Found', description: 'The resource is temporarily at a different URL.' },
  304: { name: 'Not Modified', description: 'The cached copy is still valid; no body is sent.' },
  307: { name: 'Temporary Redirect', description: 'Like 302, but the method must not change.' },
  308: { name: 'Permanent Redirect', description: 'Like 301, but the method must not change.' },
  400: { name: 'Bad Request', description: 'The server could not understand the request.' },
  401: {
    name: 'Unauthorized',
    description: 'Authentication is required or failed. Really means "unauthenticated".',
  },
  403: { name: 'Forbidden', description: 'The server understood but refuses to authorise it.' },
  404: { name: 'Not Found', description: 'No resource at this URL.' },
  405: {
    name: 'Method Not Allowed',
    description: 'The method is not supported for this resource.',
  },
  408: { name: 'Request Timeout', description: 'The client took too long to send the request.' },
  409: { name: 'Conflict', description: 'The request conflicts with the current state.' },
  410: {
    name: 'Gone',
    description: 'The resource is permanently unavailable, with no forwarding address.',
  },
  418: {
    name: "I'm a teapot",
    description: 'The server refuses to brew coffee, because it is a teapot.',
  },
  422: { name: 'Unprocessable Content', description: 'Well-formed, but semantically wrong.' },
  429: { name: 'Too Many Requests', description: 'Rate limited. Check the Retry-After header.' },
  451: { name: 'Unavailable For Legal Reasons', description: 'Blocked for legal reasons.' },
  500: { name: 'Internal Server Error', description: 'The server hit an unexpected condition.' },
  501: {
    name: 'Not Implemented',
    description: 'The server does not support the functionality required.',
  },
  502: { name: 'Bad Gateway', description: 'An upstream server returned an invalid response.' },
  503: {
    name: 'Service Unavailable',
    description: 'The server is overloaded or down for maintenance.',
  },
  504: { name: 'Gateway Timeout', description: 'An upstream server did not respond in time.' },
  511: {
    name: 'Network Authentication Required',
    description: 'You need to authenticate to get network access.',
  },
};

const CLASS_NAMES: Record<number, string> = {
  1: 'Informational',
  2: 'Success',
  3: 'Redirection',
  4: 'Client Error',
  5: 'Server Error',
};

export const httpStatus = {
  data: { name: 'http' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const code = interaction.options.getInteger('code', true);
    const info = HTTP_STATUS[code];
    const statusClass = Math.floor(code / 100);

    if (!info) {
      const known = Object.keys(HTTP_STATUS).join(', ');
      await interaction.reply({
        content: `No entry for ${code}. Known codes: ${known}`,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`${code} ${info.name}`)
      .setDescription(info.description)
      .addFields({
        name: 'Class',
        value: `${statusClass}xx — ${CLASS_NAMES[statusClass] ?? 'Unknown'}`,
        inline: true,
      })
      .setURL(`https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/${code}`)
      .setFooter({ text: 'Title links to the MDN reference' });

    await interaction.reply({ embeds: [embed] });
  },
};

// ----------------------------------------------------------------- regex

const REGEX_TIMEOUT_MS = 250;

export const regex = {
  data: { name: 'regex' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const pattern = interaction.options.getString('pattern', true);
    const subject = interaction.options.getString('text', true);
    const flags = interaction.options.getString('flags') ?? 'g';

    let expression: RegExp;
    try {
      // Always include 'g' so we can enumerate every match.
      expression = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
    } catch (err) {
      await interaction.reply({
        content: `Invalid pattern: ${err instanceof Error ? err.message : 'unknown error'}`,
        ephemeral: true,
      });
      return;
    }

    const started = Date.now();
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;

    while ((match = expression.exec(subject)) !== null) {
      matches.push(match);

      // Guard against catastrophic backtracking and zero-width infinite loops.
      if (match[0] === '') expression.lastIndex += 1;
      if (matches.length >= 25 || Date.now() - started > REGEX_TIMEOUT_MS) break;
    }

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(
        matches.length
          ? `${matches.length} match${matches.length === 1 ? '' : 'es'}`
          : 'No matches',
      )
      .addFields(
        { name: 'Pattern', value: `\`\`\`\n/${pattern}/${flags}\n\`\`\``, inline: false },
        {
          name: 'Subject',
          value: `\`\`\`\n${subject.slice(0, 500)}\n\`\`\``,
          inline: false,
        },
      );

    if (matches.length) {
      const rendered = matches
        .slice(0, 10)
        .map((m, i) => {
          const groups = m.slice(1).filter((g) => g !== undefined);
          const groupText = groups.length
            ? `  groups: ${groups.map((g) => `"${g}"`).join(', ')}`
            : '';
          return `${i + 1}. "${m[0]}" at index ${m.index}${groupText}`;
        })
        .join('\n');

      embed.addFields({
        name: 'Matches',
        value: `\`\`\`\n${rendered.slice(0, 1000)}\n\`\`\``,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

// ----------------------------------------------------------------- color

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandHex(hex: string): string {
  const value = hex.replace('#', '');
  return value.length === 3
    ? value
        .split('')
        .map((c) => c + c)
        .join('')
    : value;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return [h, Math.round(s * 100), Math.round(l * 100)];
}

export const color = {
  data: { name: 'color' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const input = interaction.options.getString('hex', true).trim();

    if (!HEX_PATTERN.test(input)) {
      await interaction.reply({
        content: 'Give a hex colour like `#5865F2` or `f5a`.',
        ephemeral: true,
      });
      return;
    }

    const hex = expandHex(input).toLowerCase();
    const int = parseInt(hex, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    const [h, s, l] = rgbToHsl(r, g, b);

    // Relative luminance per WCAG, used to pick readable foreground text.
    const channel = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrastWhite = 1.05 / (luminance + 0.05);
    const contrastBlack = (luminance + 0.05) / 0.05;

    const embed = new EmbedBuilder()
      .setColor(int)
      .setTitle(`#${hex.toUpperCase()}`)
      .addFields(
        { name: 'RGB', value: `rgb(${r}, ${g}, ${b})`, inline: true },
        { name: 'HSL', value: `hsl(${h}, ${s}%, ${l}%)`, inline: true },
        { name: 'Integer', value: `${int}`, inline: true },
        {
          name: 'Readable text',
          value:
            contrastWhite > contrastBlack
              ? `White (${contrastWhite.toFixed(1)}:1)`
              : `Black (${contrastBlack.toFixed(1)}:1)`,
          inline: true,
        },
      )
      .setThumbnail(`https://singlecolorimage.com/get/${hex}/120x120`)
      .setFooter({ text: 'Contrast ratios follow WCAG; 4.5:1 is the AA threshold for body text' });

    await interaction.reply({ embeds: [embed] });
  },
};
