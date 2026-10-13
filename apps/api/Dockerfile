# API (NestJS) — image dev untuk docker compose. Jalankan dari root repo (context: .)
FROM node:22-bookworm-slim

# Chromium untuk render PDF (Puppeteer) + font (termasuk glyph ✓) + openssl untuk Prisma
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    TZ=Asia/Jakarta
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@indotek/api..."

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY docs/samples docs/samples
RUN pnpm --filter @indotek/shared build && pnpm --filter @indotek/api build

WORKDIR /app/apps/api
EXPOSE 3000
# Migrasi, seed (idempotent: user demo + import file contoh), lalu start
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts && node dist/main.js"]
