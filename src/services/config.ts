import 'dotenv/config';
import { z } from 'zod';

/**
 * 1337x mirrors. The default is the one the reference scraper uses; the
 * official domains sit behind Cloudflare and answer scripted requests with a
 * challenge, which this bot does not try to solve.
 */
export const DEFAULT_1337X_DOMAINS = 'https://www.1337xx.to';

/** Hostnames that must never be reachable through a configured domain. */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

function isIpLiteral(hostname: string): boolean {
  // URL keeps IPv6 hosts in brackets, so that check is the whole test.
  return hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/** Tests run against a local fixture server, which cannot present a certificate. */
function insecureAllowed(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

/**
 * Parses `TORRENT_1337X_DOMAINS` into a list of origins to try in order.
 *
 * Everything downstream compares against these exact origins, so this is the
 * only place a host can enter the allowlist — a scraped link or a redirect
 * never widens it.
 */
export function parse1337xDomains(
  raw?: string | null,
  options: { allowInsecure?: boolean } = {},
): string[] {
  const allowInsecure = options.allowInsecure ?? insecureAllowed();
  const entries = (raw ?? DEFAULT_1337X_DOMAINS)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error('TORRENT_1337X_DOMAINS is empty');
  }

  const origins: string[] = [];

  for (const entry of entries) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `https://${entry}`);
    } catch {
      throw new Error(`"${entry}" is not a valid URL`);
    }

    if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
      throw new Error(`"${entry}" must use https`);
    }
    if (url.username || url.password) {
      throw new Error(`"${entry}" must not carry credentials`);
    }
    if (isIpLiteral(url.hostname)) {
      throw new Error(`"${entry}" must be a hostname, not an IP address`);
    }
    if (!allowInsecure && PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
      throw new Error(`"${entry}" points at a private or local address`);
    }

    // `origin` drops the path, query and any default port, which is exactly
    // the normalisation the allowlist comparison needs.
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }

  return origins;
}

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  DISCORD_APP_ID: z.string().min(1, 'DISCORD_APP_ID is required'),
  DISCORD_PUBLIC_KEY: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default('file:./sqlite.db'),

  // Lavalink
  LAVALINK_HOST: z.string().default('localhost'),
  LAVALINK_PORT: z.coerce.number().int().default(2333),
  LAVALINK_PASSWORD: z.string().default('changeme'),

  // Dashboard
  WEB_DASHBOARD_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() === 'true' : false)),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  OAUTH_CALLBACK_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),

  // Feature flags
  MESSAGE_CONTENT_INTENT: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() === 'true' : false)),

  // Privileged. Welcome cards and auto-role need it; without it Discord never
  // sends the join event at all. Enable it in the Developer Portal first, or
  // login is rejected and the bot will not start.
  GUILD_MEMBERS_INTENT: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() === 'true' : false)),

  // Owner alert
  OWNER_DISCORD_ID: z.string().optional(),

  // Torrent search. Comma-separated; tried in order when one is unreachable.
  TORRENT_1337X_DOMAINS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parse1337xDomains(value);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err instanceof Error ? err.message : 'invalid domain list',
        });
        return z.NEVER;
      }
    }),
});

export type AppConfig = z.infer<typeof schema> & {
  WEB_DASHBOARD_ENABLED: boolean;
  MESSAGE_CONTENT_INTENT: boolean;
  GUILD_MEMBERS_INTENT: boolean;
  TORRENT_1337X_DOMAINS: string[];
};

/**
 * Read on demand rather than through `loadConfig()` so the torrent service
 * does not drag the whole Discord configuration in with it. `loadConfig()`
 * still validates the same variable at boot, so a bad value fails fast there.
 */
export function torrent1337xDomains(): string[] {
  return parse1337xDomains(process.env.TORRENT_1337X_DOMAINS);
}

export function loadConfig(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // Avoid printing secrets; only print key names
    const which = first?.path?.join('.') ?? 'UNKNOWN_ENV';
    const msg = first?.message ?? 'Invalid configuration';
    console.error(`Missing/invalid env: ${which}: ${msg}. Check .env or environment variables.`);
    process.exit(1);
  }
  return parsed.data as AppConfig;
}
