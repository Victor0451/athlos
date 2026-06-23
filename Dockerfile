# syntax=docker/dockerfile:1.7

# --- Stage 1: builder ---
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/*/package.json ./apps/
COPY packages/*/package.json ./packages/

RUN corepack enable && pnpm fetch

COPY . .

RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @athlos/db generate

# --- Stage 2: runner ---
FROM node:22-alpine AS runner

RUN apk add --no-cache tini bash postgresql-client

# Install tsx globally for runtime TS execution
RUN corepack enable && npm install -g tsx

WORKDIR /app

RUN addgroup -g 1001 athlos && adduser -D -G athlos -u 1001 athlos

# Copy workspace structure from builder
COPY --from=builder --chown=athlos:athlos /app/node_modules ./node_modules
COPY --from=builder --chown=athlos:athlos /app/apps ./apps
COPY --from=builder --chown=athlos:athlos /app/packages ./packages
COPY --from=builder --chown=athlos:athlos /app/packages/db ./packages/db
COPY --from=builder --chown=athlos:athlos /app/scripts ./scripts
COPY --from=builder --chown=athlos:athlos /app/apps/api/src/index.ts ./apps/api/src/index.ts
COPY --from=builder --chown=athlos:athlos /app/apps/api/package.json ./apps/api/package.json

# Copy entrypoint
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER athlos

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["tsx", "apps/api/src/index.ts"]