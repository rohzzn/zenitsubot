import pino from 'pino';

export interface CapturedLog {
  time: number;
  level: 'warn' | 'error' | 'fatal';
  msg: string;
  detail?: string;
}

const RING_SIZE = 100;
const ring: CapturedLog[] = [];

const base = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['env.DISCORD_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'headers.authorization'],
    remove: true,
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
});

/** Pulls a human-readable cause out of pino's `{ err }` / `{ reason }` convention. */
function describe(context: unknown): string | undefined {
  if (typeof context !== 'object' || context === null) return undefined;

  const candidate =
    (context as { err?: unknown }).err ??
    (context as { reason?: unknown }).reason ??
    (context as { error?: unknown }).error;

  if (!candidate) return undefined;
  if (candidate instanceof Error) return `${candidate.name}: ${candidate.message}`;
  if (typeof candidate === 'string') return candidate;

  const shaped = candidate as { name?: string; type?: string; message?: string };
  if (shaped.message) return `${shaped.name ?? shaped.type ?? 'Error'}: ${shaped.message}`;
  return undefined;
}

/**
 * Mirrors warn-and-above into a bounded in-memory ring so `/logs` can surface
 * recent failures without shelling into the container. Never persisted.
 */
function capture(level: CapturedLog['level'], args: unknown[]) {
  const [first, second] = args;
  const msg =
    typeof first === 'string' ? first : typeof second === 'string' ? second : '(no message)';

  ring.push({ time: Date.now(), level, msg, detail: describe(first) });
  if (ring.length > RING_SIZE) ring.shift();
}

export function recentLogs(limit = 15): CapturedLog[] {
  return ring.slice(-limit).reverse();
}

type LogFn = (...args: [unknown, ...unknown[]]) => void;

function mirrored(level: CapturedLog['level']): LogFn {
  return (...args) => {
    capture(level, args);
    (base[level] as (...a: unknown[]) => void)(...args);
  };
}

export const logger = Object.assign(Object.create(base) as typeof base, {
  warn: mirrored('warn'),
  error: mirrored('error'),
  fatal: mirrored('fatal'),
});
