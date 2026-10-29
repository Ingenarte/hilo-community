# syntax=docker/dockerfile:1.7

# ─── deps stage ──────────────────────────────────────────────────────────────
# Install ALL dependencies (including dev) once. Building better-sqlite3
# requires a working python+make+g++ toolchain on alpine.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ \
 && corepack enable \
 && corepack prepare pnpm@10.34.6 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile=false

# ─── build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable \
 && corepack prepare pnpm@10.34.6 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# PUBLIC_BASE_URL is needed at build time: svelte.config.js bakes it into the
# CSRF trusted-origins list. Compose passes it from .env as a build arg.
ARG PUBLIC_BASE_URL=
ENV PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
# Build-time placeholders; real values come from compose environment at runtime.
# SvelteKit's analyse step imports server modules which run env.ts's required() checks.
RUN ADMIN_EMAIL=build@placeholder.local \
    AUTH_FIXED_PASSWORD=build_placeholder \
    SESSION_SECRET=build_placeholder_overridden_at_runtime_xxxxxxxxxxxxxxxxxxxxxx \
    SMTP_USER=build@placeholder.local \
    SMTP_PASS=build_placeholder \
    pnpm build \
 && pnpm prune --prod \
 && rm -rf .svelte-kit/{generated,output/client,output/prerendered}

# ─── runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/hilo.db \
    UPLOAD_DIR=/data/uploads
# ffmpeg builds the AAC rendition of WebM/Ogg voice messages (plays on iPhone).
RUN apk add --no-cache tini sqlite ffmpeg \
 && addgroup -S hilo && adduser -S -G hilo -h /app hilo \
 && mkdir -p /data/uploads /data \
 && chown -R hilo:hilo /app /data
COPY --from=build --chown=hilo:hilo /app/build ./build
COPY --from=build --chown=hilo:hilo /app/node_modules ./node_modules
COPY --from=build --chown=hilo:hilo /app/package.json ./package.json
COPY --from=build --chown=hilo:hilo /app/scripts ./scripts
COPY --from=build --chown=hilo:hilo /app/src/lib/server/schema.sql ./src/lib/server/schema.sql

USER hilo
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/index.js"]
