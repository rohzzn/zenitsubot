const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const TOKEN = /(\d+)\s*(s|m|h|d|w|sec|secs|seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?)/gi;

function unitKey(raw: string): string | undefined {
  const unit = raw.toLowerCase();
  if (unit.startsWith('s')) return 's';
  if (unit.startsWith('mi') || unit === 'm') return 'm';
  if (unit.startsWith('h')) return 'h';
  if (unit.startsWith('d')) return 'd';
  if (unit.startsWith('w')) return 'w';
  return undefined;
}

/**
 * Parses compound durations like "1h30m", "2 days", "45s".
 * Returns null when nothing parseable is found, so callers can show usage help.
 */
export function parseDuration(input: string): number | null {
  let total = 0;
  let matched = false;

  for (const match of input.matchAll(TOKEN)) {
    const amount = Number(match[1]);
    const key = unitKey(match[2]!);
    if (!key || !Number.isFinite(amount)) continue;

    total += amount * UNIT_MS[key]!;
    matched = true;
  }

  return matched && total > 0 ? total : null;
}

/** Renders a millisecond span as "1d 2h 3m", omitting zero components. */
export function formatDuration(ms: number): string {
  const units: Array<[string, number]> = [
    ['w', UNIT_MS.w!],
    ['d', UNIT_MS.d!],
    ['h', UNIT_MS.h!],
    ['m', UNIT_MS.m!],
    ['s', UNIT_MS.s!],
  ];

  let remaining = ms;
  const parts: string[] = [];

  for (const [label, size] of units) {
    const value = Math.floor(remaining / size);
    if (value > 0) {
      parts.push(`${value}${label}`);
      remaining -= value * size;
    }
    if (parts.length === 2) break;
  }

  return parts.join(' ') || '0s';
}
