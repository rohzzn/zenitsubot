# --- Builder ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* .npmrc* ./
RUN npm ci || (echo "Falling back to npm install" && npm install)
COPY tsconfig.json .eslintrc.cjs .prettierrc ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate
RUN npm run build

# --- Runner ---
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -fsS http://localhost:${PORT:-3000}/healthz || exit 1
CMD ["./entrypoint.sh"]


