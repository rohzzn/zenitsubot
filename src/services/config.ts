import 'dotenv/config';
import { z } from 'zod';

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

  // Owner alert
  OWNER_DISCORD_ID: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema> & {
  WEB_DASHBOARD_ENABLED: boolean;
  MESSAGE_CONTENT_INTENT: boolean;
};

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
