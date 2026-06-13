# Athlos

Club Atlético Gorriti operator console — monorepo.

## Prerequisites

- Node.js 22+ (`nvm use` to pick the pinned version)
- pnpm 9+ (`npm install -g pnpm@9`)
- Docker + Docker Compose (for the local Postgres)

## Quick start

```bash
nvm use                       # picks up .nvmrc (Node 22)
corepack enable               # or: npm install -g pnpm@9
pnpm install
cp .env.example .env
docker compose up db -d       # starts Postgres
pnpm --filter @athlos/api dev # http://localhost:3001
pnpm --filter @athlos/web dev # http://localhost:3000
```

## Layout

```
apps/
  web/   — Next.js 15 operator console (Gorriti Premium design)
  api/   — Fastify 5 backend
packages/
  (db, auth, errors, config, validation, … — coming in PR 2+)
```

## Development

```bash
pnpm lint              # ESLint across all workspaces
pnpm format            # Prettier across all workspaces
pnpm typecheck         # tsc --noEmit across all workspaces
```

Pre-commit hooks (Husky + lint-staged) run ESLint and Prettier on staged files.

## Stack

- **Language:** TypeScript 5.7 (strict, ES2022, Bundler resolution)
- **Web:** Next.js 15 (App Router) + React 19 + Tailwind 3
- **API:** Fastify 5 + Pino + Zod
- **DB:** PostgreSQL 16 (Drizzle ORM lands in PR 2)
- **Package manager:** pnpm workspaces
- **Visual identity:** Gorriti Premium — see `openspec/changes/athlos-foundation/specs/ui-design/spec.md`
