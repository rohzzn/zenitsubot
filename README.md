# ZenitsuBot

Production-ready Discord bot in TypeScript with music (Lavalink), utilities, moderation, and a minimal web dashboard.

## Requirements
- Node.js >= 18
- Docker (for Lavalink and deployment)

## Setup
1. Copy `.env.example` to `.env` and fill in values. Do not commit `.env`.
2. Install deps: `npm ci`
3. Generate Prisma: `npx prisma generate`
4. Register commands (global): `npm run register:commands`
5. Dev run: `npm run dev`

## Docker
- Build and run with Lavalink: `docker-compose up -d --build`
- The bot will connect to Lavalink at `LAVALINK_HOST:LAVALINK_PORT`.

## Intents & Permissions
- Gateway Intents: Guilds, GuildMessages, GuildVoiceStates (+ MessageContent if feature flag is on)
- Scopes: `bot`, `applications.commands`
- Permissions: Send Messages, Manage Messages, Embed Links, Add Reactions, Connect, Speak, Use Voice Activity

## Commands (MVP)
- General: `/ping`, `/help`
- Music: `/join`, `/play <query>`, `/pause`, `/resume`, `/skip`, `/stop`

## Health
- Web server exposes `/healthz` when `WEB_DASHBOARD_ENABLED=true`.

## Development Scripts
- `npm run dev` – ts-node-dev
- `npm run build` – tsc build
- `npm run start` – run compiled
- `npm run register:commands` – upsert global slash commands

## Notes
- Never log tokens. Missing envs will exit the process with an error.
- Migrations: use `prisma migrate dev` locally, `prisma migrate deploy` in prod.


