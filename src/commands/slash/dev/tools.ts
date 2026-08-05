import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

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

const STYLES = [
  { style: 't', label: 'Short time' },
  { style: 'T', label: 'Long time' },
  { style: 'd', label: 'Short date' },
  { style: 'D', label: 'Long date' },
  { style: 'f', label: 'Short date/time' },
  { style: 'F', label: 'Long date/time' },
  { style: 'R', label: 'Relative' },
] as const;

/** Accepts "now", a relative offset like "+30m", Unix seconds/ms, or a date. */
function resolveInstant(input: string | null): Date | null {
  if (!input || input.trim().toLowerCase() === 'now') return new Date();

  const value = input.trim();
  const relative = value.match(RELATIVE_PATTERN);

  if (relative) {
    const amount = Number(relative[1]);
    const unit = UNIT_SECONDS[relative[2]!.toLowerCase()];
    if (unit) return new Date(Date.now() + amount * unit * 1000);
  }

  if (/^\d{10}$/.test(value)) return new Date(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return new Date(Number(value));

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const timestamp = {
  data: { name: 'timestamp' },
  category: 'dev',
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const instant = resolveInstant(interaction.options.getString('when'));

    if (!instant) {
      await interaction.reply({
        content:
          'Could not read that time. Try `now`, an offset like `+30m` or `-2d`, a Unix timestamp, or `2026-12-25 18:00`.',
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
      .setFooter({ text: "Renders in each viewer's own timezone" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

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
      // Guard against zero-width infinite loops and catastrophic backtracking.
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
        { name: 'Subject', value: `\`\`\`\n${subject.slice(0, 500)}\n\`\`\``, inline: false },
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
