# Web (React/Vite) — build statis lalu disajikan nginx; /api diproksikan ke service api.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@indotek/web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
ENV VITE_API_URL=/api
RUN pnpm --filter @indotek/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
