# Exploration: athlos-current-state-analysis

**Date:** 2026-06-18
**Scope:** Holistic read-only analysis of Athlos (code repo + Obsidian vault + OpenSpec).
**Purpose:** Establish ground truth before the user decides what to ship next.

---

## Project state (code)

### Stack confirmed

- **Package manager / language:** pnpm 9.15.9 workspaces, Node 22, TypeScript 5.7.2 (strict, ES2022, Bundler resolution).
- **Apps (`apps/*`):** `@athlos/web` (Next.js **16.2.9** + React 19, App Router, Tailwind 3) and `@athlos/api` (Fastify 5, Pino, Zod). Confirmed via `apps/web/package.json`.
- **Packages (`packages/*`, 18 total):**
  - Core: `@athlos/auth`, `@athlos/approval`, `@athlos/db`, `@athlos/config`, `@athlos/errors`, `@athlos/validation`
  - Domain business: `@athlos/import`, `@athlos/lineage`, `@athlos/projection`, `@athlos/drift`, `@athlos/freshness`, `@athlos/audit`, `@athlos/notifications`, `@athlos/scheduler`
  - Infra: `@athlos/test-builders`, `@athlos/vitest-config`
- **Integration adapters (`packages/integrations/*`, 4):** `clock`, `email`, `legacy-db` (DBF reader), `whatsapp` — hexagonal/clean architecture shape.
- **DB:** PostgreSQL 16 (5 schemas: public, socios, contabilidad, tesoreria, deportes) + Drizzle ORM.
- **Test/Quality:** Vitest 2.1.x, strict TDD mode enabled, Husky pre-commit → lint-staged.
- **CI:** `.github/workflows/test.yml` runs Postgres service + `pnpm install --frozen-lockfile` + `pnpm test:run` + `pnpm typecheck` on PR and push to `main`.

### Monorepo layout (high-level)

```
apps/
  web/      # Next.js 16.2.9 operator console
  api/      # Fastify 5 backend (modules/, plugins/, routes/, services/, jobs/, container.ts)
packages/
  (18 internal pkgs + 4 integrations under packages/integrations/)
.atl/                       # LLM skill-registry cache + .md index (auto-generated)
docs/runbook.md             # Deploy + rollback + DATA_STEWARD grant + import sanity checklist
.github/workflows/test.yml
.husky/pre-commit           # → lint-staged
openspec/                   # OpenSpec change tracker + current capability specs
```

- `apps/api/src/{container.ts, server.ts, plugins/, modules/, routes/, jobs/, services/}` — clean / hexagonal shape. AppContainer wires `permissionsRepo`, `projectionService`, `driftService`, `freshnessService`, `auditPlugin`, `auditService`, etc.
- `apps/web/src/{app/, styles/}` — App Router only (no Pages Router).
- Migrations live under `packages/db/drizzle/` (drizzle-kit). The latest IDs referenced in code are `0007_entity_uuids` … `0011_audit_idempotency_partial_index`.
- 439/439 tests passing per CHANGELOG v0.3.1.

### Last change on main

- `athlos-import-completion` (change id) — fully archived at `openspec/changes/athlos-import-completion/archive/2026-06-18/`.
- 3 stacked-to-main slices merged in this order:
  - **PR 7b.1a** — `entity_uuids` + `@athlos/lineage` + `@athlos/projection` + UUID lookup-or-create + 2 job swaps
  - **PR 7b.1b** — `@athlos/drift` + `@athlos/freshness` + 1 job swap
  - **PR 7b.2** — `@athlos/audit` (fp-wrap, CI guard) + 8 routes + reconciliation job + TASK-060a cancel
- Resulted in v0.2.0 → v0.3.0 → v0.3.1 (the v0.3.1 bump was a post-verify hotfix that wired DATA_STEWARD routing into `notifications/dispatcher.resolveDrift()`).
- A pre-archive verify-report flagged one CRITICAL failure (notifications fanout still going to ADMINs); v0.3.1 fixed it via PR #5.

### Health signals

| Signal | Status | Evidence |
|--------|--------|----------|
| README quality | **STALE / misleading** | Says "Next 15", "Drizzle lands in PR 2", packages "coming in PR 2+"; reality is Next 16.2.9 + 18 packages + v0.3.1. |
| Docker setup | OK | `docker-compose.yml` + `Dockerfile` + `.dockerignore` present. |
| `.atl/` | OK | Skill registry cache present (LLM-facing index of available skills). |
| `.github/workflows/` | OK (sparse) | Only `test.yml`. No deploy workflow, no lint-only workflow, no coverage upload. |
| Husky | OK | `pre-commit` runs lint-staged. No `commit-msg` enforcement of conventional commits. |
| CI grep guards | OK | `ci-check-audit-fp.sh` enforces `fp()` wrap on `auditPlugin`. |
| CHANGELOG | OK | Up-to-date with v0.3.1, compare links now present (fixed in v0.3.1). |
| OpenSpec hygiene | OK | Both changes archived with snapshots; current `specs/` reflects merged deltas. |

---

## Documentation state (Obsidian)

### Structure

7 top-level folders + 0-Index + 0-README:

| Folder | Files | Purpose |
|--------|------:|---------|
| `1-Project/` | 4 | Overview, context, vision, plus a `2-Architecture/` subfolder |
| `2-Architecture/` | 6 | Decisions, system design, local-vs-cloud, gaps, legacy arch, UI style |
| `3-Tech-Stack/` | 3 | Stack, frontend, backend |
| `4-Data-Model/` | 5 | Schema, legacy table structures, PG schema, auth spec/design |
| `5-Modules/` | 7 | Inventory + 6 legacy-driven product modules |
| `6-Migration/` | 11 (incl. two `0-…`) | Executive summary, strategy, ETL, switchover, sync, reconciliation, parameter map, cutover playbook |
| `7-Roadmap/` | 1 | Product roadmap + SDD PR status |

### Index / MOC quality

- **`0-Index.md` (211 lines, updated 2026-06-17):** Real MOC, not a stub. Sections: project state, legacy analysis, 20 spec summaries, design doc pointer, data model, roadmap, OpenSpec structure, search table, conventions. Tables are well-formed. **But the "0. Estado del proyecto" header claims `athlos-import-completion` is "en curso"** — that change was archived on 2026-06-18. STALE.
- **`0-README.md` (107 lines, updated 2026-06-11):** Real navigation page, but the embedded metadata block says `Estado: Planning` and the tech stack table says Next.js 14, Fastify 4, Node 20, PostgreSQL 15+ — **all wrong vs current code reality** (v0.3.1, Next 16.2.9, Fastify 5, Postgres 16, Node 22). This is the worst-stale doc in the vault.

### Per-folder sample

- **`1-Project/0-Overview.md`** — Solid. Product-level framing (legacy FoxPro replacement, 9 stakeholders). Aligned with roadmap.
- **`2-Architecture/0-Decisions.md`** (468 lines) — **The best-maintained doc in the vault.** Reflects current truth: Next 16.2.9, App Router, shadcn/ui custom (Gorriti Premium tokens), 5 schemas, Fastify, etc. References `multi-tenancy` spec for v1 single-tenant stance.
- **`2-Architecture/3-Gaps-Analysis.md`** — 624 lines, has a "Gaps cerrados (20/20) ✅" table. PR status table partially duplicates `7-Roadmap/0-Roadmap.md` and shows some duplicate rows (e.g., PR 3a/3b appears twice with conflicting statuses — once ✅, once ⏳). Internal inconsistency.
- **`3-Tech-Stack/0-Stack.md`** — Says Next 14 / Fastify 4 / Postgres 15+ — STALE on versions (Decisions doc is authoritative and up-to-date).
- **`4-Data-Model/2-PostgreSQL-Schema.md`** — Likely aligned (5 schemas match Decisions #3). Not deeply audited.
- **`5-Modules/0-Inventory.md`** — Product modules (Padrón, Cuenta Corriente, Cuota Social, Disciplinas, Escuela, Contabilidad, Tesorería, Reportes, Auth y Roles). These are LEGACY-DRIVEN product concepts. The packages in `packages/*` are mostly INFRASTRUCTURE concerns (audit, drift, freshness, projection, lineage, scheduler). No mapping exists between product modules and code packages — see Drift findings below.
- **`6-Migration/`** — 11 files covering legacy analysis, ETL, switchover, reconciliation. Heavily legacy-side; very little of this code has shipped yet (only `packages/import` + `packages/lineage` + `packages/projection` + `packages/drift` + `packages/freshness` are in).
- **`7-Roadmap/0-Roadmap.md`** — Two-layer doc: top half is the 5-month product roadmap (Fase 0–4), bottom half is the SDD PR status. The bottom half says PR 7b.1a is implemented and 7b.1b + 7b.2 are pending — STALE (all three merged; change archived).

### Roadmap status vs reality

- **Product roadmap (top of `7-Roadmap/0-Roadmap.md`):** 5-month phased delivery — Fase 0 (setup) → Fase 4 (switchover). Per the doc, **Fase 0 setup is mostly complete** (Docker, Next+API base, basic auth — although product feature mapping is unclear).
- **SDD PR status (bottom):** `athlos-foundation` (12 PRs, 322 tests) ✅ archived. `athlos-import-completion` (3 slices) ⏳ → **now ✅ archived** per `openspec/changes/athlos-import-completion/archive/2026-06-18/`. Three follow-up changes (`athlos-ui`, `athlos-deploy`, `athlos-e2e`) are listed but **none have an OpenSpec folder yet**.

---

## Alignment (code ↔ Obsidian ↔ OpenSpec)

### Module ↔ Package map (partial, inferred)

| Obsidian `5-Modules` (product) | Implemented in code (package + module path) | Status |
|---|---|---|
| Padrón de Socios | `apps/api/src/modules/socios/*` + `@athlos/db` repositories | Shipped (PR 5) |
| Cuenta Corriente | `apps/api/src/modules/ctacte/*` + `@athlos/db` | Shipped (PR 5) |
| Auth y Roles | `@athlos/auth` + `@athlos/approval` + `@athlos/db/role_permissions` | Shipped (PR 3a/3b + 7b.2) |
| Disciplinas / Escuela / Contabilidad / Tesorería / Cuota Social / Reportes | Legacy-only so far (no dedicated module folder under `apps/api/src/modules/`) | NOT YET implemented as product modules |
| (Cross-cutting) | `@athlos/import`, `@athlos/lineage`, `@athlos/projection`, `@athlos/drift`, `@athlos/freshness`, `@athlos/audit`, `@athlos/notifications`, `@athlos/scheduler` | Shipped — these are infra, not product modules |
| `apps/web/src/app/` | UI surface | Only foundation/blank so far — real UI ships in `athlos-ui` (PR 8a/8b/8c) |

**Drift:** `5-Modules/0-Inventory.md` lists 9 legacy-driven product modules but no doc maps them to the 18 packages. The implemented packages are almost all infrastructure / cross-cutting; the product modules themselves (Padrón CRUD, Cuenta Corriente, Cuota Social flows) live inside `apps/api/src/modules/socios` and `apps/api/src/modules/ctacte` per the foundation's PR 5. This is non-obvious and undocumented.

### Drift findings

1. **`README.md` is materially wrong** (Next 15 → should be 16.2.9; "Drizzle lands in PR 2" → already in; "packages coming in PR 2+" → 18 packages already shipped).
2. **`obsidian/0-README.md` is the most stale doc** — wrong versions on Next, Fastify, Node, Postgres; `Estado: Planning`; no mention of any shipped PR.
3. **`obsidian/3-Tech-Stack/0-Stack.md` versions are wrong** (Next 14, Fastify 4, Postgres 15+). The authoritative source is `obsidian/2-Architecture/0-Decisions.md`, which is correct.
4. **`obsidian/0-Index.md` and `obsidian/7-Roadmap/0-Roadmap.md` both say `athlos-import-completion` is "en curso" / 7b.1b + 7b.2 pending** — reality: archived on 2026-06-18.
5. **`obsidian/2-Architecture/3-Gaps-Analysis.md` has internal duplicates** in the PR-status table (PR 3a/3b appear twice with conflicting status).
6. **OpenSpec `openspec/specs/` ↔ foundation `openspec/changes/athlos-foundation/specs/` drift:**
   - `validation-zod/` was renamed to `validation/` in root specs (no rename note).
   - `user-management-rbac/` exists in foundation snapshot but is MISSING from root `openspec/specs/` (RBAC content appears to be folded into `auth-login/spec.md` — but this rename/merge is undocumented).
   - New capabilities added by `athlos-import-completion`: `audit-logger`, `drift-detector`, `freshness-monitor`, `lineage-tracker`, `projection-engine` — all present in root specs ✅.
7. **No mapping doc** between legacy-driven product modules (`5-Modules`) and the 18 shipped infrastructure packages.
8. **Follow-up changes referenced in Obsidian but not started in repo**: `athlos-ui`, `athlos-deploy`, `athlos-e2e` — none have folders under `openspec/changes/`.

### Alignments (positive)

- `obsidian/2-Architecture/0-Decisions.md` is up-to-date with code (Next 16.2.9, App Router, shadcn/ui custom, 5 schemas, Fastify 5, Drizzle).
- `CHANGELOG.md` is current (v0.3.1, compare links present per Keep-a-Changelog).
- OpenSpec archive snapshots exist for both changes; archive-report.md pattern used consistently.
- The CI grep guard `ci-check-audit-fp.sh` is a real `fp()` enforcement, and the verify-report flagged it as ✅ PASS.
- Test count is consistent across docs (439/439).

---

## OpenSpec hygiene

### Active changes

- **0 active changes** as of 2026-06-18. Both `athlos-foundation` and `athlos-import-completion` are archived.

### Archived changes

| Change | Archived | Lines (approx.) | Purpose |
|--------|----------|----------------:|---------|
| `athlos-foundation` | 2026-06-16 | 25 specs in snapshot, ~6,700 lines of design | 12 PRs of foundation: bootstrap, data, auth, API, scheduler, notifications, import foundation |
| `athlos-import-completion` | 2026-06-18 | 8 delta specs, ~1,200L design, 33 tasks | 3 PRs (7b.1a / 7b.1b / 7b.2) — lineage, projection, drift, freshness, audit, routes, jobs |

Both archives follow the pattern: `archive/{date}/{archive-report.md, design-snapshot.md, proposal-snapshot.md, tasks-snapshot.md, verify-report.md}`. Hygiene is good.

### Specs vs Obsidian

- 24 current capabilities in `openspec/specs/`. The Obsidian `0-Index.md` lists 20 of them (the +4 are the import-completion additions: `audit-logger`, `drift-detector`, `freshness-monitor`, `lineage-tracker`, `projection-engine`).
- Obsidian `1-Project/2-Architecture/` does not auto-sync with OpenSpec; the Obsidian spec coverage is hand-curated and partly behind the curve.
- One Obsidian file (`obsidian/4-Data-Model/3-Auth-Login-Spec.md` and `4-Auth-Login-Design-Decisions.md`) mirrors `openspec/specs/auth-login/spec.md` content — risk of divergence if auth spec changes.

---

## Top 5 gaps / risks

1. **`README.md` is materially misleading.** A new contributor reading the repo root would believe Next 15 is current, Drizzle is "coming in PR 2", and the `packages/` directory is mostly empty — none of which is true. **High-priority fix.**
2. **Obsidian MOC entry points are stale.** `0-Index.md` says import-completion is in-flight; `7-Roadmap/0-Roadmap.md` says 7b.1b + 7b.2 are pending; `0-README.md` says "Planning" with wrong stack versions; `3-Tech-Stack/0-Stack.md` has wrong versions. These are the docs a returning user opens first — risk of bad re-entry decisions.
3. **No module ↔ package map.** `5-Modules` lists 9 product modules; the code has 18 infrastructure packages and a sparse `apps/api/src/modules/` with only `socios` + `ctacte`. Without a map, future devs (and future sdd-* sub-agents) can't tell whether "Cuota Social" is a separate module to build or a screen inside `ctacte`. This is the most consequential documentation gap.
4. **OpenSpec specs/ drift is undocumented.** `validation-zod` → `validation` rename and the disappearance of `user-management-rbac/` (folded into `auth-login`?) have no commit-style note in either folder. Future audits will be confused.
5. **Three follow-up changes advertised in the roadmap are not started.** `athlos-ui` (8a/8b/8c), `athlos-deploy` (9), `athlos-e2e` (10b) — listed as the next deliverables in both `0-Index.md` and `7-Roadmap/0-Roadmap.md`, but `openspec/changes/` has no folders for them. Either start them or retire the roadmap entries.

## Recommendations (concrete, ordered)

1. **Refresh `README.md` (code repo) first** — bump to "Athlos v0.3.1 — Club Atlético Gorriti operator console", replace the "Layout" block with the real apps+packages list, fix the Stack section (Next 16.2.9, Fastify 5, Postgres 16, 18 packages, 439 tests).
2. **Refresh Obsidian entry points in one pass:**
   - `0-Index.md` — change "Change `athlos-import-completion` en curso" → "Change `athlos-import-completion` archivado el 2026-06-18"; add v0.3.1 row.
   - `0-README.md` — update `Estado` to "v0.3.1 shipped (foundation + import-completion completos)"; replace the tech-stack table with the real versions or remove it (point to `0-Decisions.md`).
   - `3-Tech-Stack/0-Stack.md` — point to `2-Architecture/0-Decisions.md` as the source of truth; trim versions, or fix them.
   - `7-Roadmap/0-Roadmap.md` — flip 7b.1b + 7b.2 from ⏳ to ✅, add v0.3.1 hotfix note.
3. **Create `5-Modules/8-Module-Package-Map.md`** — a single table mapping each legacy-driven product module to its current implementation (or "not yet started" if it isn't). Anchor the doc so future sdd-* sub-agents don't have to re-derive this.
4. **Reconcile OpenSpec `specs/` drift** — either restore `user-management-rbac/spec.md` at root or add a one-line note at the top of `auth-login/spec.md` documenting the merge. Same for the `validation-zod` → `validation` rename.
5. **Decide and start `athlos-deploy` next.** Of the three follow-ups, `athlos-deploy` is the one marked "independiente, puede correr en paralelo" in the roadmap. Concretely: there's only `Dockerfile` + `docker-compose.yml` and a single test CI — there's no deploy workflow, no staging promotion, no pg_dump script despite the runbook promising it. Smallest path to value. `athlos-ui` is the biggest visible gap (web app is mostly empty `app/` shell) but is the most expensive; defer until deploy lands.

### What the orchestrator should flag to the user

- The code repo and Obsidian vault are at v0.3.1 (shipped) but the user-facing docs (README + Obsidian entry points) still describe an earlier state. This is **the single most important reality to communicate** — the gap between "what's true" and "what the docs say" is now wide enough to misdirect any new contributor or returning session.
- After the import-completion cycle, the natural next move is **infrastructure/devops** (`athlos-deploy`) before product UI work, because the runbook references deploy procedures (`pg_dump`, migrations, DATA_STEWARD grant, rollback) that have no automation yet.

---

## Ready for proposal?

**Yes** — for a `athlos-docs-refresh` change that updates README.md + the four stale Obsidian entry points + adds the Module-Package map. This is a small, well-scoped doc-only change with clear acceptance criteria.

**Yes** — for a `athlos-deploy` change (proposal + design + tasks). It's been called out as the natural next step in the roadmap and the path of least resistance.

**Not yet** — for `athlos-ui` or `athlos-e2e`. Both need a sizing decision (screen inventory + E2E flow inventory) before a proposal can be drafted; that's a separate exploration.

---

## Persisted artifacts

- This file: `openspec/changes/explore-athlos-current-state-analysis/exploration.md`
- Engram topic key: `sdd/explore/athlos-current-state-analysis` (architecture)