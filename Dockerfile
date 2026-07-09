# syntax=docker/dockerfile:1.7

# --- Stage 1: builder ---
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/*/package.json ./apps/
COPY packages/*/package.json ./packages/

# Pin pnpm to the version declared in package.json `packageManager` field.
# Without this, corepack tries to auto-download whatever version it detects,
# which fails at runtime when network is unreachable or /app/ isn't writable.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm fetch

COPY . .

RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @athlos/db generate

# --- Stage 2: runner ---
FROM node:22-alpine AS runner

# PR 8d.1 (athlos-socio-form-emit): puppeteer needs the chromium
# runtime libraries that are NOT bundled with the alpine base image.
# Install them in the RUNNER stage (not the builder) so the chromium
# libs are NOT in the build cache. `apk add --no-cache` keeps the
# runner image lean. The `chromium` package version is pinned below
# — bumping it is a deliberate decision (test fixtures depend on it).
RUN apk add --no-cache \
    tini \
    bash \
    postgresql-client \
    curl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    cairo \
    pango \
    libintl \
    libssl3

# Pin pnpm + install tsx. Both as root (USER athlos below can't write to
# /usr/local/lib). corepack prepare activates the pinned version so the
# runtime NEVER tries to auto-download a different version.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && npm install -g tsx

WORKDIR /app

RUN addgroup -g 1001 athlos && adduser -D -G athlos -u 1001 athlos

# Copy workspace structure from builder
COPY --from=builder --chown=athlos:athlos /app/node_modules ./node_modules
COPY --from=builder --chown=athlos:athlos /app/package.json ./package.json
COPY --from=builder --chown=athlos:athlos /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder --chown=athlos:athlos /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=athlos:athlos /app/apps ./apps
COPY --from=builder --chown=athlos:athlos /app/packages ./packages
COPY --from=builder --chown=athlos:athlos /app/packages/db ./packages/db
COPY --from=builder --chown=athlos:athlos /app/scripts ./scripts
COPY --from=builder --chown=athlos:athlos /app/apps/api/src/index.ts ./apps/api/src/index.ts
COPY --from=builder --chown=athlos:athlos /app/apps/api/package.json ./apps/api/package.json

# Copy entrypoint
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# scripts/ must be executable so the entrypoint can run backup.sh,
# restore.sh, mount-usb.sh, etc. The athlos user can't chmod these at
# runtime (no sudo, no write access to /app/).
RUN chmod +x /app/scripts/*.sh /app/scripts/lib/*.sh 2>/dev/null || true

# Make /app/ writable by athlos so corepack/pnpm can write _tmp_* files
# during dependency resolution. Without this the entrypoint fails with
# EACCES when pnpm tries to write to /app/_tmp_<hash>.
RUN chmod 777 /app

USER athlos

# PR 8d.1: tell puppeteer to use the system chromium package instead
# of downloading its own (~170 MB savings). Mirrors the args the
# runtime applies in `pdf-generator.ts`.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_ARGS="--no-sandbox --disable-dev-shm-usage"

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["tsx", "apps/api/src/index.ts"]
