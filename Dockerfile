FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
# The entrypoint applies pending migrations before the bot starts.
COPY scripts ./scripts

RUN npm run build

# Keeps the Prisma CLI, which lives in dependencies precisely so that
# `prisma migrate deploy` is available at container start.
RUN npm prune --omit=dev

RUN chmod +x scripts/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["scripts/entrypoint.sh"]
