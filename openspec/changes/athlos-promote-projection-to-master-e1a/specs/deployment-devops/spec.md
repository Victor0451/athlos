# Delta for deployment-devops

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1a` |
| **Date** | 2026-06-24 |
| **Phase** | Spec |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for design |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md` |
| **Modified capability** | `deployment-devops` (PARTIAL atomic sync — B1b LESSON #1 applied incrementally) |
| **Source artifacts** | `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md` · `openspec/changes/athlos-promote-projection-to-master-e1a/proposal.md` |
| **Sister change (DONE)** | `athlos-deploy-slice-d-ci-deploy` (v0.5.0, archived 2026-06-24) |
| **Sister slice (NEXT)** | `athlos-promote-projection-to-master-e1b` — 5 remaining domains (escuela, deportes, locacion, caja, gastos) |
| **Sister slice (LAST)** | `athlos-promote-projection-to-master-e2` — admin API + `promoted_at` migration + docs + canonical spec sync for E1b+E2 |
| **Target release** | v0.5.0 → **v0.5.1** (PATCH — closes data-pipeline gap, no schema change) |
| **B1b LESSONs embedded** | #1 partial atomic sync · #2 separate release commit · #3 cherry-pick reorder · #4 merge-before-delete |

> **PARTIAL SPEC SYNC NOTE (B1b LESSON #1, CRITICAL).** This delta captures E1a scope ONLY: 3 priority-domain scenarios + the data-layer algorithm + CLI runner. E1b and E2 will each add their own scenarios in their own atomic syncs. The `diff` against `openspec/specs/deployment-devops/spec.md` SHALL be empty only AFTER E2's sync lands. Verify checklist item 8.3 captures this incremental contract.

> **CTACTE1 DEFERRED TO E1b (post-merge data model gap, 2026-06-24).** During the post-merge smoke test, the `ctacte1` → `ctacte` foreign-key lookup failed: `entity_uuids.source_key` does not contain values that match `payload.CCTCUENTA` in the projection, AND `tesoreria.ctacte` master has no `cctcuenta` column to preserve the VFP natural key after promotion. Without either, the FK cannot be resolved at promotion time. Code-level fixes (field name corrections in the transform + dedup compound keys + simpler JOIN in `fk-lookup.ts`) are shipped in E1a; the `ctacte1` PROMOTION_ORDER position + scenario remain in the spec for E1b to wire after a schema change (add `cctcuenta` column to `tesoreria.ctacte` master, backfill from raw_events during rebuildProjection). E1b's spec delta will rewrite the `ctacte1` scenario IN-PLACE with the schema-aware FK strategy.

---

## Context

Slice D (v0.5.0) shipped the deploy automation roadmap — every merge to `main` builds, pushes to GHCR, SSH-deploys to `192.168.1.102`, polls `/health/ready` for 60s, and auto-rolls back on failure. The deploy loop is closed. The data import pipeline, however, stops one stage short of the master tables: `packages/import/` ships DBF → `raw_events` (652,661 rows imported); `packages/projection/` ships `raw_events` → `*_projection` (621,448 rows across 8 projection tables). All 8 master tables (`socios.socios`, `tesoreria.ctacte`, `tesoreria.ctacte1`, `escuela.escuela`, `deportes.deportes`, `locacion.locacion`, `caja.caja_movimiento`, `tesoreria.gastos`) are still EMPTY. The only writer is the admin REST API (`POST /api/v1/socios`, etc.), designed for 5 manual entries per week — not 39,357 socios + 326,275 ctacte rows.

Slice E1a is the FIRST of three stacked PRs (`E1a` + `E1b` + `E2`) that close the gap. E1a ships the data-layer foundation only: a new `packages/promotion/` workspace package, a `promoteDomain` + `promoteAll` algorithm, per-domain transforms for the 3 priority domains (`socios`, `ctacte`, `ctacte1`), a bulk FK-lookup pattern (`SELECT id, nro_socio FROM socios.socios` → in-memory `Map<int, uuid>`), dedup by natural key, batched INSERTs with `ON CONFLICT DO NOTHING`, a CLI runner wired via `pnpm db:promote`, and 5+ TDD vitest cases. After E1a merges, an operator can run `pnpm db:promote` against the test DB and watch 39,357 socios + 326,275 ctacte + 245,370 ctacte1 populate the master tables. E1b adds the 5 remaining domains; E2 wires the admin HTTP trigger, adds the `raw_events.promoted_at` migration for true audit-trail idempotency, updates `docs/runbook.md`, and produces the final atomic canonical sync (8 → full scenarios).

This delta modifies the `deployment-devops` capability by adding a 9th requirement (`Promotion Pipeline`) and 6 new success criteria. No existing requirements are rewritten — E1a's contribution is purely additive, leaving room for E1b and E2 to extend the requirement in subsequent PRs.

---

## Capability: `deployment-devops` (modified)

### Requirement: Promotion Pipeline

The system SHALL provide a workspace package (`packages/promotion/`) that reads rows from each `*_projection` table, transforms each `jsonb` payload into a typed row matching the corresponding master table, resolves foreign keys via bulk in-memory lookups (NOT per-row queries), inserts in batches of 1000 rows with `ON CONFLICT DO NOTHING` for idempotency, and exposes a CLI runner accessible via the root script `pnpm db:promote`. Per E1a scope, only 3 priority domains are wired: `socios`, `ctacte`, and `ctacte1`. The remaining 5 domains (`escuela`, `deportes`, `locacion`, `caja`, `gastos`) and the admin HTTP endpoint are explicitly OUT OF SCOPE for this delta (deferred to E1b and E2 respectively).

The system SHALL enforce a topological promotion order (`PROMOTION_ORDER = ['socios', 'ctacte', 'ctacte1']`) such that FK targets are populated before dependents: `socios` MUST be promoted before `ctacte` (ctacte.socio_id → socios.id), and `ctacte` MUST be promoted before `ctacte1` (ctacte1.ctacte_id → ctacte.id). The system SHALL NOT fail-fast on per-domain errors; instead, it SHALL collect per-row failures in a `errors[]` array, increment the `failed` counter, and short-circuit downstream domains ONLY when the upstream domain inserted zero rows AND had failures (the FK-cascade rule).

#### Scenario: Promotion: socios (jsonb → typed `socios.socios`)

- GIVEN `socios.socios_projection` contains 39,357 rows with VFP jsonb payloads (columns: `SOCCARNET`, `SOCAPYNOMB`, `SOCFECNACI`, `SOCDNI`, etc.)
- AND `socios.socios` (master) is empty
- WHEN the operator runs `pnpm db:promote` (which executes `packages/promotion/src/promote-cli.ts`)
- THEN the `socios` transform SHALL read each projection row, parse `payload.SOCCARNET` → `numero_socio` (String), split `payload.SOCAPYNOMB` into `apellido` (first word) and `nombre` (rest) via `splitApellidoNombre`, parse `payload.SOCFECNACI` → `fecha_nacimiento` (nullable `timestamp with time zone`) via `parseFechaVFP`, map `payload.SOCDNI` → `dni` (String)
- AND SHALL default `estado = 'activo'`, `categoria_id = null`, `direccion = null`, `telefono = null`, `email = null`
- AND SHALL insert into `socios.socios` in batches of 1000 rows with `ON CONFLICT DO NOTHING`
- AND SHALL return `{ domain: 'socios', attempted: 39357, inserted: 39357, skipped: 0, failed: 0, errors: [], durationMs: <N> }`
- AND `SELECT COUNT(*) FROM socios.socios` SHALL return 39357 after the run completes

#### Scenario: Promotion: ctacte (FK dependency on `socios.socios`)

- GIVEN `tesoreria.ctacte_projection` contains 326,275 rows
- AND `socios.socios` has been populated by the prior promotion step (39357 rows from the previous scenario)
- WHEN the `ctacte` promotion step runs
- THEN the algorithm SHALL execute exactly ONE `SELECT id, nro_socio FROM socios.socios` query (the bulk FK lookup) — NOT 326,275 per-row queries
- AND SHALL load the result into an in-memory `Map<string, uuid>` (key = `numero_socio`, value = `socios.id`) in O(N) time where N = 39357
- AND for each ctacte projection row SHALL compute `socio_id = map.get(String(payload.CCTCUENTA))` in O(1)
- AND if the lookup returns `null` (no matching socio), the row SHALL be skipped with `errors.push({ sourceKey: <CCTNUMERO>, reason: 'no matching socio' })` — the promotion does NOT fail-fast
- AND SHALL parse `payload.CCTDEBEHAB` (= 1 → `tipo = 'DEBITO'`; = -1 → `tipo = 'CREDITO'`) via `splitDebeHaber`
- AND SHALL parse `payload.CCTIMPORTE` into `debe` / `haber` NUMERIC(14,2) columns based on `tipo`
- AND SHALL insert into `tesoreria.ctacte` in batches of 1000 with `ON CONFLICT DO NOTHING`
- AND SHALL return `{ domain: 'ctacte', attempted: 326275, inserted: 326275, skipped: 0, failed: 0, errors: [], durationMs: <N> }` on the happy path (zero missing FKs)
- AND `SELECT COUNT(*) FROM tesoreria.ctacte` SHALL return 326275 after the run completes

#### Scenario: Promotion: ctacte1 (FK dependency on `tesoreria.ctacte`)

- GIVEN `tesoreria.ctacte1_projection` contains 245,370 rows (sub-ledger of ctacte, FK on `ctacte_id`)
- AND `tesoreria.ctacte` has been populated by the prior promotion step (326,275 rows from the previous scenario)
- WHEN the `ctacte1` promotion step runs
- THEN the algorithm SHALL execute ONE bulk lookup against the freshly-promoted ctacte rows to resolve `ctacte_id` (the exact query is implementation-defined but SHALL be a single batched SELECT, not 245,370 per-row queries)
- AND SHALL load the result into an in-memory `Map<string, uuid>` keyed by `ctacte.numero` + `ctacte.item` (composite natural key)
- AND for each ctacte1 row SHALL compute `ctacte_id = map.get(<composite-key>)`
- AND if the lookup returns `null` (no matching parent row), the row SHALL be skipped with `errors.push({ sourceKey: <CCT1NUMERO>, reason: 'no matching ctacte' })` — the promotion does NOT fail-fast
- AND SHALL insert into `tesoreria.ctacte1` in batches of 1000 with `ON CONFLICT DO NOTHING`
- AND SHALL return `{ domain: 'ctacte1', attempted: 245370, inserted: 245370, skipped: 0, failed: 0, errors: [], durationMs: <N> }` on the happy path
- AND `SELECT COUNT(*) FROM tesoreria.ctacte1` SHALL return 245370 after the run completes

> **DEFERRED to E1b (out of scope for this delta, will be added by `athlos-promote-projection-to-master-e1b`):**
>
> - Scenario: Promotion: escuela
> - Scenario: Promotion: deportes
> - Scenario: Promotion: locacion
> - Scenario: Promotion: caja
> - Scenario: Promotion: gastos

> **DEFERRED to E2 (out of scope for this delta, will be added by `athlos-promote-projection-to-master-e2`):**
>
> - Scenario: Promotion: admin API endpoint — `POST /api/v1/promote/trigger` (sync HTTP, ADMIN-gated)
> - Scenario: Promotion: audit trail — `raw_events.promoted_at TIMESTAMPTZ NULL` column + auto-stamp on successful promotion
> - Scenario: Promotion: idempotency across re-runs — currently relies on `ON CONFLICT DO NOTHING` + UNIQUE constraints; E2 introduces the `promoted_at` audit column for full per-row idempotency tracking

---

## Success Criteria (6 NEW for E1a scope)

1. **E1a NEW**: `pnpm --filter @athlos/promotion test` exits 0 with 5+ vitest cases covering: (a) `promoteDomain('socios')` happy path with 1-row projection fixture, (b) `promoteDomain('ctacte')` FK resolution via in-memory map, (c) `promoteDomain('ctacte')` skipped with clear error when socios upstream has zero insertions, (d) dedup on re-run (second run produces `{inserted:0, skipped:N}` for all 3 domains), (e) per-domain isolation (failure in `socios` does NOT crash `promoteAll`), (f) VFP date parsing (`"19750315"` → `1975-03-15`) and `CCTDEBEHAB` enum mapping (1 → `DEBITO`, -1 → `CREDITO`).
2. **E1a NEW**: `pnpm db:promote` against the test DB (`192.168.1.102:5432/athlos`) populates `socios.socios` with exactly 39,357 rows; the CLI stdout shows `{domain:'socios', inserted:39357, skipped:0, failed:0}` in the per-domain JSON output.
3. **E1a NEW**: `pnpm db:promote` against the test DB populates `tesoreria.ctacte` with exactly 326,275 rows; the CLI stdout shows `{domain:'ctacte', inserted:326275, skipped:0, failed:0}`.
4. **E1a NEW**: `pnpm db:promote` against the test DB populates `tesoreria.ctacte1` with exactly 245,370 rows; the CLI stdout shows `{domain:'ctacte1', inserted:245370, skipped:0, failed:0}`.
5. **E1a NEW**: Re-running `pnpm db:promote` immediately after a successful run produces 0 new inserts across all 3 domains (idempotent via `ON CONFLICT DO NOTHING` + the natural-key dedup pre-check in `dedup.ts`); the per-domain JSON shows `{inserted:0, skipped:N}` where N matches the prior run's `inserted`.
6. **E1a NEW**: Running `pnpm db:promote` after manually truncating `socios.socios` (zero rows) while `socios_projection` still contains 39,357 rows SHALL result in `socios.inserted = 39357` AND `ctacte.inserted = 0` (FK dependency enforced — ctacte cannot resolve any `CCTCUENTA` → `socios.id`) AND `ctacte1.inserted = 0`; the per-domain JSON for ctacte and ctacte1 SHALL include `errors:[{reason:'no matching socio'}]` / `errors:[{reason:'no matching ctacte'}]` for the affected rows.

> Existing canonical criteria #1-30 (post-Slice D) remain unchanged. E1a adds criteria #31-36 above. E1b will add criteria for the 5 remaining domains; E2 will add criteria for the admin endpoint, the `promoted_at` audit column, and the canonical spec sync verification.

---

## Scope Boundary

### In scope for E1a (this delta ships)

| Item | Description |
|------|-------------|
| `packages/promotion/` package skeleton | New workspace package with `package.json`, `tsconfig.json`, vitest config (TDD harness only — no build artifact) |
| `promoteDomain(db, domain)` algorithm | Reads projection rows, applies transform, batches INSERTs with `ON CONFLICT DO NOTHING`, returns `PromotionResult` |
| `promoteAll(db)` algorithm | Iterates `PROMOTION_ORDER` = `['socios', 'ctacte', 'ctacte1']`; FK-cascade short-circuit when upstream inserted zero rows + had failures |
| 3 priority-domain transforms | `transforms/socios.ts`, `transforms/ctacte.ts`, `transforms/ctacte1.ts` — jsonb payload → typed Drizzle insert |
| Bulk FK lookup pattern | ONE `SELECT id, nro_socio FROM socios.socios` → in-memory `Map` for ctacte; ONE batched SELECT for ctacte1 → in-memory `Map` keyed by composite natural key |
| Dedup by natural key | `SOCCARNET` for socios, `CCTNUMERO` for ctacte, `(CCT1NUMERO, CCT1ITEM)` composite for ctacte1 |
| Batched INSERT | 1000 rows/batch with `ON CONFLICT DO NOTHING` (mirrors `packages/import/src/pipeline.ts:insertRawEventBatch` pattern) |
| CLI runner | `packages/promotion/src/promote-cli.ts` — prints per-domain JSON + summary, calls `pool.end()` on exit |
| Root script | `package.json` (root) gains `"db:promote": "pnpm --filter @athlos/promotion run promote"` |
| 5+ TDD vitest cases | RED-first against an isolated test schema (`athlos_promotion_test`) with `DROP SCHEMA ... CASCADE` in `afterEach` |
| Partial canonical sync | NEW "Promotion Pipeline" requirement added to `openspec/specs/deployment-devops/spec.md` (this delta is the canonical sync for E1a only) |

### Deferred to E1b (`athlos-promote-projection-to-master-e1b`)

| Item | Description |
|------|-------------|
| 5 remaining domain transforms | `transforms/escuela.ts`, `transforms/deportes.ts`, `transforms/locacion.ts`, `transforms/caja.ts`, `transforms/gastos.ts` |
| 5 NEW scenarios in `Promotion Pipeline` | One scenario per domain, mirroring the E1a shape (jsonb → typed, FK lookup if any, batched INSERT, expected row count) |
| `PROMOTION_ORDER` extension | Append the 5 domains in topological order (escuela and deportes have no FK dependents in E1a scope; caja/gastos may depend on ctacte) |
| 5 NEW success criteria | Per-domain expected row counts from `promoteAll` smoke test |
| `docs/runbook.md` mention | Brief "Available domains" section (optional; can wait for E2) |

### Deferred to E2 (`athlos-promote-projection-to-master-e2`)

| Item | Description |
|------|-------------|
| Admin API endpoint | `POST /api/v1/promote/trigger` (sync HTTP, ADMIN-gated, returns 200 + JSON array of `PromotionResult` on success) |
| `promoted_at` migration | Drizzle migration `0012_promoted_at.sql` adds `promoted_at TIMESTAMPTZ NULL` to `raw_events`; promotion step stamps `NOW()` on the source `raw_events.id` rows after successful INSERT |
| Async trigger via `@athlos/scheduler` | Optional cron-like scheduled promotion (e.g., nightly) |
| `docs/runbook.md` "Promotion" section | Full runbook: pre-flight checks, expected row counts, rollback procedure (`DELETE FROM master WHERE created_at > $ts`) |
| Dry-run mode | `{dryRun: true}` flag on the admin endpoint — executes transforms but skips INSERT, returns what WOULD be inserted |
| `/promote/status/:jobId` endpoint | Async progress polling (only if E2 ships the async variant) |
| Canonical spec sync for E1b + E2 | E1b and E2 each produce their own atomic canonical sync delta — the FINAL canonical after E2 merges contains the full set of scenarios (3 from E1a + 5 from E1b + admin endpoint + audit trail + idempotency) |
| 4 NEW success criteria | Admin endpoint reachable, audit column populated, idempotency across re-runs (via `promoted_at`), spec diff assertion for full sync |

### Deferred to FUTURE (out of scope, not planned for any of the 3 slices)

| Item | Reason |
|------|--------|
| `pg_advisory_lock` for concurrent-promotion prevention | CLI runner is single-tenant; not a problem until the admin endpoint becomes async or multi-user |
| Per-socio bulk promotion (subset re-promotion) | Not requested; full re-promotion is acceptable for v0.5.x |
| Web UI for promotion status | Out of project scope |
| CONTABLE / CONTABL1 / CATASTROS domains | Master tables do not exist yet |
| CONNROASIE bridge table | Handled by `validateBridges` in `@athlos/import` (already shipped in Slice B-7c) |
| Rollback endpoint | Manual SQL is sufficient for now; can add an admin endpoint in a future slice |

---

## Out of Scope (re-stated for clarity)

- **No schema migration** in E1a. `raw_events.promoted_at` is E2 only. Re-runs in E1a rely on UNIQUE constraints + `ON CONFLICT DO NOTHING` + natural-key dedup.
- **No HTTP endpoint** in E1a. The admin `POST /api/v1/promote/trigger` is E2 only. E1a ships the CLI runner only.
- **No async / no scheduler** in E1a. The CLI is synchronous and operator-invoked.
- **No dry-run flag** in E1a (per user lock #5). Full promotion only.
- **No `docs/runbook.md` update** in E1a (deferred to E2).
- **No chained PRs within E1a** (per user lock #1). E1a alone is one PR; E1b + E2 follow as separate stacked PRs.

---

## Acceptance Criteria (delta-specific, pre-apply checklist)

These are the E1a deltas' acceptance criteria; the full set lives in `proposal.md` §8. Restated here for spec-phase completeness:

- [ ] New "Promotion Pipeline" requirement added to `openspec/specs/deployment-devops/spec.md` with EXACTLY the 3 priority-domain scenarios above (no rewrites of pre-existing requirements)
- [ ] 6 new success criteria appended to canonical (criteria #31-36)
- [ ] Spec delta explicitly documents the 5 E1b + 3 E2 deferred scenarios in `> DEFERRED` callout blocks (this file)
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md` returns ONLY the additive changes (no removals, no rewrites)
- [ ] After E2's sync lands, the same `diff` SHALL be empty (final atomic canonical sync per B1b LESSON #1)
- [ ] No `docs/runbook.md` change in E1a
- [ ] No migration added in E1a

---

## Open Questions

**NONE.** All 5 user-locked decisions confirmed in `proposal.md` §11:

1. Sub-slice shape: 3 stacked PRs (E1a + E1b + E2) ✓
2. Audit trail: `promoted_at` column deferred to E2 ✓
3. Transactions: per-domain isolation ✓
4. Trigger: sync HTTP endpoint deferred to E2; E1a ships CLI only ✓
5. Dry-run: NO dry-run flag for E1a ✓

---

## Ready for design?

**Yes.** The spec captures the E1a scope precisely: the data-layer algorithm, 3 priority-domain transforms with full FK dependency handling, dedup + batched INSERT + CLI runner, and 6 acceptance criteria tied to concrete row counts from the test DB. E1b and E2 each have their own open questions (e.g., `gastos` field mapping for the legacy `composeGastosKey` integration; admin endpoint auth flow); those are intentionally NOT in this delta. The partial canonical sync (B1b LESSON #1) is documented explicitly so verify-phase can assert the `diff` returns only additive changes.

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e1a/spec` (after `mem_save`)*
