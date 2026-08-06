FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp for /download. The standalone build bundles its own Python, so the
# image needs neither a Python runtime nor pip. ffmpeg is deliberately not
# installed: merging separate video and audio streams needs it, but Discord
# caps uploads at 10 MB here anyway, so we only ever fetch already-muxed
# progressive formats that are small enough to send.
ARG YTDLP_VERSION=2026.07.04
RUN ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in \
       arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;; \
       amd64) YTDLP_ASSET=yt-dlp_linux ;; \
       *) echo "unsupported arch $ARCH" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /usr/local/bin/yt-dlp \
       "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_ASSET}" \
  && chmod +x /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version

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
