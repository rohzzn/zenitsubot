import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { createHash, randomUUID } from 'node:crypto';
import { ZENITSU_THEME } from '../../../utils/constants.js';

const MAX_FIELD = 1000;

function block(text: string, lang = ''): string {
  const body = text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

export const base64 = {
  data: { name: 'base64' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const mode = interaction.options.getString('mode', true);
    const input = interaction.options.getString('text', true);

    let output: string;
    if (mode === 'encode') {
      output = Buffer.from(input, 'utf8').toString('base64');
    } else {
      const decoded = Buffer.from(input, 'base64');
      // Base64 decoding never fails outright — it silently drops invalid
      // characters — so re-encode and compare to catch malformed input.
      if (
        decoded.toString('base64').replace(/=+$/, '') !==
        input.replace(/=+$/, '').replace(/\s/g, '')
      ) {
        await interaction.reply({
          content: 'That does not look like valid base64.',
          ephemeral: true,
        });
        return;
      }
      output = decoded.toString('utf8');
    }

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(mode === 'encode' ? 'Base64 encoded' : 'Base64 decoded')
      .addFields(
        { name: 'Input', value: block(input), inline: false },
        { name: 'Output', value: block(output), inline: false },
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export const hash = {
  data: { name: 'hash' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const algorithm = interaction.options.getString('algorithm', true);
    const input = interaction.options.getString('text', true);

    const digest = createHash(algorithm).update(input, 'utf8').digest('hex');

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`${algorithm.toUpperCase()} digest`)
      .addFields(
        { name: 'Input', value: block(input), inline: false },
        { name: 'Digest', value: block(digest), inline: false },
      )
      .setFooter({ text: 'Hashing is not encryption — never use this for passwords' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export const uuid = {
  data: { name: 'uuid' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const count = interaction.options.getInteger('count') ?? 1;
    const ids = Array.from({ length: count }, () => randomUUID());

    await interaction.reply({
      content: block(ids.join('\n')),
      ephemeral: true,
    });
  },
};

interface JwtSegment {
  [key: string]: unknown;
}

/** Claims whose values are Unix seconds and read better as real dates. */
const TIME_CLAIMS = new Set(['exp', 'iat', 'nbf', 'auth_time', 'updated_at']);

function decodeSegment(segment: string): JwtSegment | null {
  try {
    const json = Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as JwtSegment) : null;
  } catch {
    return null;
  }
}

function annotate(payload: JwtSegment): string {
  const lines = Object.entries(payload).map(([key, value]) => {
    if (TIME_CLAIMS.has(key) && typeof value === 'number') {
      return `${key}: ${value}  →  ${new Date(value * 1000).toISOString()}`;
    }
    return `${key}: ${JSON.stringify(value)}`;
  });
  return lines.join('\n');
}

export const jwt = {
  data: { name: 'jwt' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const token = interaction.options.getString('token', true).trim();
    const parts = token.split('.');

    if (parts.length !== 3) {
      await interaction.reply({
        content: 'That is not a JWT — expected three dot-separated segments.',
        ephemeral: true,
      });
      return;
    }

    const header = decodeSegment(parts[0]!);
    const payload = decodeSegment(parts[1]!);

    if (!header || !payload) {
      await interaction.reply({ content: 'Could not decode that token.', ephemeral: true });
      return;
    }

    const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    const expiryNote = exp
      ? exp < Date.now()
        ? `Expired <t:${Math.floor(exp / 1000)}:R>`
        : `Expires <t:${Math.floor(exp / 1000)}:R>`
      : 'No expiry claim';

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle('JWT decoded')
      .setDescription(expiryNote)
      .addFields(
        { name: 'Header', value: block(annotate(header), 'yaml'), inline: false },
        { name: 'Payload', value: block(annotate(payload), 'yaml'), inline: false },
      )
      .setFooter({
        text: 'Decoded only — the signature is NOT verified. Never paste a token you still use.',
      });

    // Always ephemeral: tokens are credentials and must not land in channel history.
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
