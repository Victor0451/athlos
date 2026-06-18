# Athlos

Club Atlético Gorriti operator console — monorepo.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Layout](#layout)
- [Stack](#stack)
- [Development](#development)
- [Testing](#testing)
- [Packages & Modules](#packages--modules)
- [Versión en Español](#versión-en-español)

---

## Overview

Athlos is the operator console for Club Atlético Gorriti — a web-based club management system covering member registries (Padrón), current accounts (Cuenta Corriente), sports disciplines, school management, accounting, treasury, and reporting.

## Prerequisites

- Node.js 22+ (`nvm use` to pick the pinned version)
- pnpm 9.15.9+ (`npm install -g pnpm@9`)
- Docker + Docker Compose (for the local Postgres 16 database)

> **Versiones ancladas:** Next.js 16.2.9 · Fastify 5 · Postgres 16 · pnpm 9.15.9 · Node 22 · TypeScript 5.7.2 (strict)

## Quick Start

```bash
nvm use                       # picks up .nvmrc (Node 22)
corepack enable               # or: npm install -g pnpm@9
pnpm install
cp .env.example .env
docker compose up db -d       # starts Postgres 16
pnpm --filter @athlos/api dev # http://localhost:3001
pnpm --filter @athlos/web dev # http://localhost:3000
```

## Layout

```
apps/
  web/   — Next.js 16.2.9 operator console (Gorriti Premium design)
  api/   — Fastify 5 backend
packages/
  db, auth, errors, config, validation, approval, scheduler,
  notifications, lineage, projection, drift, freshness, audit, import,
  test-builders, vitest-config
  (18 packages total)
packages/integrations/
  clock, email, legacy-db, whatsapp
  (4 integration adapters)
```

## Stack

- **Language:** TypeScript 5.7.2 (strict, ES2022, Bundler resolution)
- **Web:** Next.js 16.2.9 (App Router) + React 19 + Tailwind 3
- **API:** Fastify 5 + Pino + Zod
- **DB:** PostgreSQL 16 (Drizzle ORM)
- **Package manager:** pnpm workspaces
- **Visual identity:** Gorriti Premium — see `openspec/changes/athlos-foundation/specs/ui-design/spec.md`

## Development

```bash
pnpm lint              # ESLint across all workspaces
pnpm format            # Prettier across all workspaces
pnpm typecheck         # tsc --noEmit across all workspaces
```

Pre-commit hooks (Husky + lint-staged) run ESLint and Prettier on staged files.

## Testing

```bash
pnpm test              # run all tests (Vitest)
```

**439/439 tests passing** — strict TDD enforced across all packages.

## Packages & Modules

### ✅ Shipped (v0.3.1)

| Package / Module        | Role                                      |
| ----------------------- | ----------------------------------------- |
| `@athlos/db`            | PostgreSQL schemas + repositories         |
| `@athlos/auth`          | JWT + refresh token auth + Approval Links |
| `@athlos/approval`      | High-risk action approval workflow        |
| `@athlos/config`        | Zod env validation                        |
| `@athlos/errors`        | BusinessError / TechnicalError            |
| `@athlos/validation`    | Runtime validation (Zod)                  |
| `@athlos/scheduler`     | Cron job orchestrator                     |
| `@athlos/notifications` | Email + WhatsApp + in-app                 |
| `@athlos/import`        | Legacy FoxPro → Postgres ETL              |
| `@athlos/lineage`       | Entity import lineage tracking            |
| `@athlos/projection`    | Denormalized read-model builder           |
| `@athlos/drift`         | Schema drift detection                    |
| `@athlos/freshness`     | Domain freshness monitoring               |
| `@athlos/audit`         | Operator audit trail                      |
| `apps/api`              | Fastify 5 REST API (11 route domains)     |
| `apps/web`              | Next.js 16 operator console               |

### 🔜 Planned (follow-up changes)

| Change          | Scope                                                      | Status          |
| --------------- | ---------------------------------------------------------- | --------------- |
| `athlos-ui`     | Caching + UI primitives + auth/socios/ctacte screens + PWA | not yet started |
| `athlos-deploy` | Multi-stage Dockerfile + docker-compose prod + GH Actions  | not yet started |
| `athlos-e2e`    | Playwright + 5 critical flows + CI test workflow           | not yet started |

---

## Versión en Español

### Descripción

Athlos es la consola de operaciones del Club Atlético Gorriti — un sistema web de gestión que cubre padrón de socios, cuenta corriente, disciplinas deportivas, escuela, contabilidad, tesorería y reportes.

### Requisitos previos

- Node.js 22+ (`nvm use` para activar la versión fijada)
- pnpm 9.15.9+ (`npm install -g pnpm@9`)
- Docker + Docker Compose (para la base de datos Postgres 16 local)

> **Versiones ancladas:** Next.js 16.2.9 · Fastify 5 · Postgres 16 · pnpm 9.15.9 · Node 22 · TypeScript 5.7.2 (strict)

### Inicio rápido

```bash
nvm use                       # picks up .nvmrc (Node 22)
corepack enable               # or: npm install -g pnpm@9
pnpm install
cp .env.example .env
docker compose up db -d       # starts Postgres 16
pnpm --filter @athlos/api dev # http://localhost:3001
pnpm --filter @athlos/web dev # http://localhost:3000
```

### Estructura

```
apps/
  web/   — Consola operador Next.js 16.2.9 (diseño Gorriti Premium)
  api/   — Backend Fastify 5
packages/
  db, auth, errors, config, validation, approval, scheduler,
  notifications, import, lineage, projection, drift, freshness, audit
  (18 paquetes)
packages/integrations/
  clock, email, legacy-db, whatsapp
  (4 adaptadores de integración)
```

### Stack tecnológico

- **Lenguaje:** TypeScript 5.7.2 (strict, ES2022, Bundler resolution)
- **Web:** Next.js 16.2.9 (App Router) + React 19 + Tailwind 3
- **API:** Fastify 5 + Pino + Zod
- **Base de datos:** PostgreSQL 16 (Drizzle ORM)
- **Gestor de paquetes:** pnpm workspaces
- **Identidad visual:** Gorriti Premium

### Desarrollo

```bash
pnpm lint              # ESLint en todos los workspaces
pnpm format            # Prettier en todos los workspaces
pnpm typecheck         # tsc --noEmit en todos los workspaces
```

Pre-commit hooks (Husky + lint-staged) corren ESLint y Prettier en archivos staged.

### Pruebas

```bash
pnpm test              # ejecutar todos los tests (Vitest)
```

**439/439 tests passing** — TDD estricto activado en todos los paquetes.

### Paquetes y Módulos

#### ✅ En producción (v0.3.1)

| Paquete / Módulo        | Rol                                               |
| ----------------------- | ------------------------------------------------- |
| `@athlos/db`            | Esquemas PostgreSQL + repositorios                |
| `@athlos/auth`          | Auth JWT + refresh token + Approval Links         |
| `@athlos/approval`      | Workflow de aprobación de acciones de alto riesgo |
| `@athlos/config`        | Validación de env con Zod                         |
| `@athlos/errors`        | BusinessError / TechnicalError                    |
| `@athlos/validation`    | Validación en runtime (Zod)                       |
| `@athlos/scheduler`     | Orquestador de jobs cron                          |
| `@athlos/notifications` | Email + WhatsApp + in-app                         |
| `@athlos/import`        | ETL FoxPro legacy → Postgres                      |
| `@athlos/lineage`       | Seguimiento de linaje de importación              |
| `@athlos/projection`    | Constructor de modelos de lectura desnormalizados |
| `@athlos/drift`         | Detección de deriva de esquema                    |
| `@athlos/freshness`     | Monitoreo de frescura por dominio                 |
| `@athlos/audit`         | Registro de auditoría de operadores               |
| `apps/api`              | API REST Fastify 5 (11 dominios de ruta)          |
| `apps/web`              | Consola operador Next.js 16                       |

#### 🔜 Planificados (cambios futuros)

| Cambio          | Alcance                                                      | Estado    |
| --------------- | ------------------------------------------------------------ | --------- |
| `athlos-ui`     | Caching + UI primitives + pantallas auth/socios/ctacte + PWA | pendiente |
| `athlos-deploy` | Dockerfile multi-stage + docker-compose prod + GH Actions    | pendiente |
| `athlos-e2e`    | Playwright + 5 flujos críticos + workflow de tests CI        | pendiente |
