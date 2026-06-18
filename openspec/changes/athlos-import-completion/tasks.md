# Tasks: athlos-import-completion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,030L total (7b.1a ~560L / 7b.1b ~460L / 7b.2 ~650L) |
| 400-line budget risk | MED |
| Chained PRs recommended | Yes |
| Suggested split | 7b.1a → 7b.1b → 7b.2 (stacked-to-main) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

```
Decision needed before apply: NO
Chained PRs recommended: YES
Chain strategy: stacked-to-main
400-line budget risk: MED
```

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Data plane foundations (lineage + projection + 2 job bodies) | PR 7b.1a | Base = main; migrations 0007 + 0008 + 0009; tests included |
| 2 | Data plane completion (drift + freshness + 1 job body) | PR 7b.1b | Base = PR 7b.1a; depends on UUID lifecycle + rebuild |
| 3 | Route + audit plane (audit + routes + TASK-060a + 1 job body) | PR 7b.2 | Base = PR 7b.1b; auditPlugin MUST be registered after authPlugin |

---

## Phase 7b.1a: Data plane foundations

**Goal**: lineage lookup works end-to-end with UUID; projection rebuilds one domain idempotently; 2 of 4 job bodies swapped.

- [x] **TASK-061** — `packages/db/drizzle/0007_entity_uuids.sql` + Drizzle schema `entityUuids` in `packages/db/src/schema/public.ts`. Composite PK `(source_table, source_key)`, unique `entity_uuid` column. **Files (new)**: `0007_entity_uuids.sql` (~10L), `public.ts` (~8L). **Deps**: none. **AC**: migration applies; `entity_uuids` table has correct PK + unique constraint; `EntityUuid` type exported.

- [x] **TASK-062** — `packages/lineage` package skeleton: `vitest.config.ts`, `package.json`, `src/index.ts` barrel exporting `queryLineage` + `verifyHash`. **Files (new)**: 3. **Lines ~20. **Deps**: none. **AC**: `pnpm --filter @athlos/lineage build` clean; barrel re-exports both functions.

- [x] **TASK-063** — `packages/lineage/src/query.ts` — `queryLineage(db, entityId: UUID): Promise<LineageResponse>` returning 5-field shape (`entity_id, source_table, source_key, content_hash, imported_at, import_batch, audit_event_id`). Join `entity_uuids` + `raw_events`. **Strict TDD**: `packages/lineage/src/query.test.ts` — RED first: fixture with known UUID returns 5 fields; unknown UUID returns null. **Files (new/modified)**: `query.ts` (~35L), `query.test.ts` (~40L). **Deps**: TASK-061, TASK-062. **AC**: returns 5-field shape for known entity; null for unknown; `audit_event_id` is null (no mutations yet).

- [x] **TASK-064** — `packages/lineage/src/verify.ts` — `verifyHash(db, entityId: UUID): Promise<HashVerificationResult>` recomputes SHA-256 from `raw_events.payload` and compares to stored `content_hash`. **Strict TDD**: `packages/lineage/src/verify.test.ts` — RED first: match=true when hash unchanged; match=false when payload differs. **Files (new/modified)**: `verify.ts` (~25L), `verify.test.ts` (~35L). **Deps**: TASK-061, TASK-062. **AC**: `match: true` when hash unchanged; `match: false` when tampered; `verified_at` is ISO8601.

- [x] **TASK-065** — `packages/import/src/pipeline.ts` — inject `getOrCreateEntityUuid` inside `insertRawEvent`: lookup by `(source_table, source_key)`, create with `crypto.randomUUID()` on miss, reuse on hit. Uses `onConflictDoNothing` + re-read. **Strict TDD**: `packages/import/src/pipeline.test.ts` — RED first: first insert generates UUID; re-import reuses same UUID; concurrent insert handled. **Files (modified)**: `pipeline.ts` (~30L), `pipeline.test.ts` (~45L). **Deps**: TASK-061. **AC**: same `(source_table, source_key)` re-imports get same UUID; different key gets different UUID.

- [x] **TASK-066** — `packages/projection` package skeleton: `vitest.config.ts`, `package.json`, `src/index.ts` barrel exporting `rebuildProjection` + `computeSaldo` + `DOMAIN_PROJECTION_TABLE`. **Files (new)**: 3. **Lines ~20. **Deps**: TASK-061. **AC**: `pnpm --filter @athlos/projection build` clean; barrel re-exports all 3.

- [x] **TASK-067** — `packages/projection/src/rebuild.ts` — `rebuildProjection(db, domain: Domain)` truncate-then-replay using `DOMAIN_PROJECTION_TABLE`. Unknown domain throws `BusinessError(VALIDATION)`. **Strict TDD**: `packages/projection/src/rebuild.test.ts` — RED first: rebuild "ctacte" twice produces identical rowCount + saldo values; unknown domain throws. **Files (new/modified)**: `rebuild.ts` (~45L), `rebuild.test.ts` (~55L). **Deps**: TASK-066. **AC**: rebuild is idempotent; `rebuildProjection('paramet')` throws VALIDATION; `rebuildProjection('ctacte')` processes only ctacte rows.

- [x] **TASK-068** — `packages/projection/src/saldo.ts` — `computeSaldo(db, socioEntityId: UUID): Promise<SaldoResult>` with `{debe, haber, saldo, as_of}` shape. Cross-domain join via EXISTS subselect (socios legacy key → ctacte rows). **Strict TDD**: `packages/projection/src/saldo.test.ts` — RED first: 3 rows (+500, -200, +100) → `{debe:500, haber:300, saldo:200}`. **Files (new/modified)**: `saldo.ts` (~40L), `saldo.test.ts` (~50L). **Deps**: TASK-067. **AC**: `debe` = sum of positive montos; `haber` = sum of absolute negative montos; `saldo = debe - haber`.

- [x] **TASK-069** — Job body swap: `apps/api/src/jobs/scheduled-import.ts` + `apps/api/src/jobs/drift-detection.ts` — replace stub body with real handler bodies per design §8 (scheduled-import calls `runImport` + post-import `rebuildProjection` + `refreshAll`; drift-detection calls `detect` + `emitDriftAlert`). **Strict TDD**: `apps/api/src/jobs/drift-detection.test.ts` — stub job still returns shape; body swap test deferred to 7b.1b. **Files (modified)**: 2. **Lines ~80L delta. **Deps**: TASK-067, TASK-068. **AC**: `scheduled-import` job body calls `runImport` then `rebuild` then `refreshAll` on success; `drift-detection` body is skeleton only (filled in 7b.1b).

---

## Phase 7b.1b: Data plane completion

**Goal**: drift detector compares hashes and fans out to DATA_STEWARD; freshness reads cache table; 1 remaining job body swapped.

- [x] **TASK-070** — `packages/db/drizzle/0008_drift_snapshots.sql` + Drizzle schema `driftSnapshots` in `packages/db/src/schema/public.ts`. PK = `entity_uuid`. **Files (new)**: `0008_drift_snapshots.sql` (~8L), `public.ts` (~6L). **Deps**: TASK-061. **AC**: migration applies; `drift_snapshots.entity_uuid` is PK referencing `entity_uuids`.

- [x] **TASK-071** — `packages/drift/src/detect.ts` — `detect(db, opts: {domain?: Domain}): Promise<DriftReport[]>` using DISTINCT ON query joining `raw_events` + `entity_uuids` + `drift_snapshots`. Reports hash mismatch. **Strict TDD**: `packages/drift/src/detect.test.ts` — RED first: 0 drift when hashes match; drift entry when hash differs. **Files (new/modified)**: `detect.ts` (~55L), `detect.test.ts` (~60L). **Deps**: TASK-070. **AC**: `drift_count: 0` when no mismatch; drift entry has `entityUuid, oldHash, newHash` when mismatch found.

- [x] **TASK-072** — `packages/drift/src/alert.ts` — `emitDriftAlert(db, report, ctx)` direct Drizzle insert into `audit_events` with `operator_id: null`; calls `NotificationDispatcher.resolveDrift()`. **Strict TDD**: `packages/drift/src/alert.test.ts` — RED first: @athlos/audit mock throws (verifies direct write path); exactly 1 audit_events row inserted with `operator_id: null`. **Files (new/modified)**: `alert.ts` (~40L), `alert.test.ts` (~50L). **Deps**: TASK-071. **AC**: @athlos/audit never called; audit_events row has `operator_id: null`; notification dispatcher called with drift count.

- [x] **TASK-073** — `packages/db/drizzle/0009_domain_freshness.sql` + Drizzle schema `domainFreshness` in `packages/db/src/schema/public.ts`. PK = `domain`. **Files (new)**: `0009_domain_freshness.sql` (~7L), `public.ts` (~5L). **Deps**: TASK-070. **AC**: migration applies; `domain_freshness.domain` is PK.

- [x] **TASK-074** — `packages/freshness/src/thresholds.ts` — `DOMAIN_THRESHOLDS` const (11 domains, ISO 8601 durations) + `ageToStatus(ageMs, thresholdMs): DomainFreshnessStatus` reducer + `ageDisplay(ageMs): string` formatter ("hace N min"). **Strict TDD**: `packages/freshness/src/thresholds.test.ts` — RED first: age < threshold → 'current'; age > threshold × 1.5 → 'stale'; null → 'unknown'; missing domain → throws. **Files (new/modified)**: `thresholds.ts` (~30L), `thresholds.test.ts` (~40L). **Deps**: TASK-073. **AC**: `DOMAIN_THRESHOLDS` has all 11 domains; missing domain throws CONFIG_MISSING; `ageDisplay` returns Spanish format.

- [x] **TASK-075** — `packages/freshness/src/api.ts` — `getFreshness(db, opts: {domain?: Domain}): Promise<DomainFreshness[]>` reads from `domain_freshness` cache table + computes `status` + `ageDisplay` on the fly. **Strict TDD**: `packages/freshness/src/api.test.ts` — RED first: 5-min-old → 'current'; 2h-old on 1h threshold → 'stale'; no rows → 'unknown'. **Files (new/modified)**: `api.ts` (~35L), `api.test.ts` (~45L). **Deps**: TASK-074. **AC**: returns all 11 domains; each row has correct `status` and `ageDisplay`; unknown domain from `opts.domain` is filtered.

- [x] **TASK-076** — Job body swap: `apps/api/src/jobs/freshness-refresh.ts` calls `refreshAll()` writing to `domain_freshness`; complete `apps/api/src/jobs/drift-detection.ts` body (full `detectAll` + loop over reports calling `emitDriftAlert`). **Files (modified)**: 2. **Lines ~50L delta. **Deps**: TASK-071, TASK-072, TASK-075. **AC**: `freshness-refresh` job writes `domain_freshness` rows for all 11 domains; `drift-detection` job body is complete (no longer skeleton).

- [x] **TASK-077** — Cross-package integration test: full chain import → `rebuildProjection` → `queryLineage` → `detect` → `getFreshness`. Use standin DB + legacy DB stub. **Files (new)**: `packages/projection/src/integration.test.ts` (~60L). **Deps**: TASK-065, TASK-067, TASK-071, TASK-075. **AC**: after import + rebuild, `queryLineage` returns correct batch; after drift detected, `getFreshness` reflects updated timestamps.

- [x] **TASK-078** — DI wiring in `apps/api/src/container.ts`: register `lineageService`, `projectionService`, `driftService`, `freshnessService` factories (each takes `db` only). **Files (modified)**: `container.ts` (~15L). **Deps**: TASK-063, TASK-067, TASK-071, TASK-075. **AC**: `container.lineageService`, `container.projectionService`, `container.driftService`, `container.freshnessService` all available; each is standalone-implementable (only dep is `db`).

---

## Phase 7b.2: Route + audit plane

**Goal**: 8 routes working with RBAC; audit middleware captures all operator writes with idempotency; 1 remaining job body swapped; CI grep guard in place.

- [x] **TASK-080** — `packages/db/drizzle/0010_role_permissions.sql` + Drizzle schema `rolePermissions` in `packages/db/src/schema/operators.ts`. Composite PK `(operator_id, permission_key)`. **Files (new)**: `0010_role_permissions.sql` (~8L), `operators.ts` (~10L). **Deps**: TASK-070. **AC**: migration applies; `role_permissions` has composite PK; no default grants.

- [x] **TASK-081** — `packages/audit` package skeleton: `vitest.config.ts`, `package.json`, `src/index.ts` barrel. **Files (new)**: 3. **Lines ~20. **Deps**: none. **AC**: `pnpm --filter @athlos/audit build` clean.

- [x] **TASK-082** — `packages/audit/src/middleware.ts` — `auditPlugin` wrapped with `fp(auditPlugin, { name: 'athlos-audit' })`. `onRequest` captures `auditCtx`; `onResponse` snapshots old value + calls `emitAudit`. **Strict TDD**: `packages/audit/src/middleware.test.ts` — RED first: plugin must be fp-wrapped (grep test); onResponse fires only on 2xx. **Files (new/modified)**: `middleware.ts` (~45L), `middleware.test.ts` (~50L). **Deps**: TASK-081. **AC**: export is `fp(...)` result; `onResponse` only fires on 2xx; non-2xx does not emit.

- [x] **TASK-083** — `packages/audit/src/emitter.ts` — `emitAudit(db, record)` with SHA-256 10s bucket idempotency key. SELECT-1 then INSERT; catch 23505 → deduped. **Strict TDD**: `packages/audit/src/emitter.test.ts` — RED first: same request within 10s → deduped; after 10s → new row; different payload within same bucket → new row. **Files (new/modified)**: `emitter.ts` (~40L), `emitter.test.ts` (~55L). **Deps**: TASK-082. **AC**: `emitAudit` returns `{inserted: false, deduped: true}` on repeat within 10s; different bucket = new row.

- [x] **TASK-084** — `packages/db/drizzle/0011_audit_idempotency_partial_index.sql` — `CREATE UNIQUE INDEX uq_audit_events_idempotency_key ON audit_events(idempotency_key) WHERE idempotency_key IS NOT NULL`. **Files (new)**: `0011_audit_idempotency_partial_index.sql` (~4L). **Deps**: TASK-083. **AC**: partial unique index excludes NULL keys; system events (NULL key) don't violate constraint.

- [x] **TASK-085** — `packages/audit/src/query.ts` — `queryAudit(db, filters)` with pagination (`limit` default 100 max 500, `page`, filters: `operator?, entity?, from?, to?`). **Strict TDD**: `packages/audit/src/query.test.ts` — RED first: query by operator returns correct rows; pagination echoes limit/page; total is unpaginated count. **Files (new/modified)**: `query.ts` (~35L), `query.test.ts` (~45L). **Deps**: TASK-083. **AC**: results ordered by `created_at DESC`; limit max 500; total count is accurate.

- [x] **TASK-086** — `apps/api/scripts/ci-check-audit-fp.sh` — CI grep guard for `fp(auditPlugin, { name: 'athlos-audit' })`. Exits 1 if pattern missing. **Files (new)**: `ci-check-audit-fp.sh` (~5L). **Deps**: TASK-082. **AC**: script exits 0 when `fp(auditPlugin` present; exits 1 when removed.

- [x] **TASK-087** — `apps/api/src/routes/lineage.ts` (`GET /api/v1/lineage/:entityId`, any auth), `apps/api/src/routes/freshness.ts` (`GET /api/v1/freshness`, any auth), `apps/api/src/routes/drift.ts` (`GET /api/v1/drift`, ADMIN OR data_steward). **Strict TDD**: `apps/api/src/routes/lineage.test.ts`, `freshness.test.ts`, `drift.test.ts` — RED first: 401 without auth; 200 with auth; correct response shape. **Files (new)**: 3 routes + 3 test files (~120L code + ~90L tests). **Deps**: TASK-063, TASK-075, TASK-071. **AC**: lineage returns 404 for unknown entity; freshness returns 11 items; drift returns drift_count and drifts array.

- [x] **TASK-088** — `apps/api/src/routes/import.ts` — `POST /trigger` (ADMIN → 202 + batchId), `GET /status` (ADMIN → last 20 runs), `GET /status/:batchId` (ADMIN → single run with progress), **`DELETE /trigger/:batchId` (ADMIN → 200 queued, 409 running, 404 unknown)**. TASK-060a cancel route. **Strict TDD**: `apps/api/src/routes/import.test.ts` — RED first: trigger 403 non-admin; cancel queued → 200; cancel running → 409; cancel unknown → 404. **Files (new/modified)**: `import.ts` (~70L), `import.test.ts` (~80L). **Deps**: TASK-069. **AC**: `DELETE` while `queued` returns 200 and sets status 'cancelled'; `running` returns 409; `cancelled` is idempotent 200.

- [x] **TASK-089** — `apps/api/src/routes/audit.ts` (`GET /api/v1/audit`, ADMIN OR data_steward). **Strict TDD**: `apps/api/src/routes/audit.test.ts` — RED first: ADMIN → 200; data_steward → 200; CONSULTA → 403. **Files (new)**: `audit.ts` (~40L), `audit.test.ts` (~40L). **Deps**: TASK-085. **AC**: query params filter correctly; pagination correct; non-admin → 403.

- [x] **TASK-090** — DI wiring in `apps/api/src/container.ts`: register `auditService` + `permissionsRepo`. Modify `apps/api/src/server.ts`: `auditPlugin` registered BEFORE all 5 route plugins; `requirePermission` gate widened to `string` in `packages/auth/src/middleware.ts`. **Files (modified)**: `container.ts` (~10L), `server.ts` (~8L), `middleware.ts` (~5L). **Deps**: TASK-080, TASK-082, TASK-087, TASK-088, TASK-089. **AC**: `auditPlugin` registered before routes; `container.auditService` available; `requirePermission('data_steward')` compiles.

- [x] **TASK-091** — Job body swap: `apps/api/src/jobs/reconciliation.ts` — calls `rebuildAll()` then `detectAll()`. Returns metadata with `mismatched_domains`, `domains_checked`, `drift_count`. **Files (modified)**: `reconciliation.ts` (~30L). **Deps**: TASK-078. **AC**: reconciliation job calls `rebuildAll` then `detectAll` sequentially; returns correct metadata shape.

- [x] **TASK-092** — Runbook update: add "Grant DATA_STEWARD permission" step in deploy checklist. Explicit `GRANT data_steward TO operator_id` via admin endpoint. **Files (modified)**: `docs/runbook.md` or equivalent (~15L). **Deps**: TASK-090. **AC**: runbook documents that zero `role_permissions` rows = zero drift alerts until admin grants.

- [x] **TASK-093** — Integration test: full pipeline end-to-end in `apps/api/test/integration/import-pipeline.spec.ts`. Import → rebuild → lineage → drift → freshness → audit route. Standin DB + legacy DB stub. **Files (new)**: `import-pipeline.spec.ts` (~80L). **Deps**: TASK-065, TASK-067, TASK-071, TASK-075, TASK-082, TASK-087, TASK-088. **AC**: full chain produces lineage response; drift detect produces audit row; freshness reflects import time.

---

## Cross-slice dependencies

- **7b.1a → 7b.1b**: TASK-065 (UUID lifecycle in import) + TASK-067 (rebuild strategy) must be merged before 7b.1b starts. 7b.1b's drift detect reads `entity_uuids` and uses the same rebuild-then-detect pattern.
- **7b.1b → 7b.2**: TASK-071 (drift detect) + TASK-074 (freshness consts) must be merged before 7b.2 starts. 7b.2's routes expose drift + freshness data; audit plugin wraps mutations that trigger drift detection.
- **7b.1a/7b.1b → 7b.2**: DI wiring in 7b.1a/7b.1b registers data-plane services only (`lineageService`, `projectionService`, `driftService`, `freshnessService`). `auditPlugin` and `auditService` are 7b.2's job — do NOT register them in 7b.1a/7b.1b container.
- **Migration order**: 0007 → 0008 → 0009 → 0010 → 0011 (all must apply before 7b.2 routes test against real DB).

---

## Critical tasks (highest risk)

- **TASK-065**: UUID lookup-or-create race condition in import pipeline — concurrent inserts for same `(source_table, source_key)` need `onConflictDoNothing` + re-read pattern.
- **TASK-071**: `DISTINCT ON` query against 390K-row `raw_events` — perf risk. Partial index on `raw_events(source_table, imported_at DESC)` deferred to follow-up migration (not in this change); monitor in 7b.1b integration test.
- **TASK-081/TASK-082**: `auditPlugin` fp-wrap is the PR 3a bug class — must be verified by `ci-check-audit-fp.sh` AND integration test. If the `fp()` wrapper is removed, the integration test must fail explicitly.
- **TASK-086**: CI grep guard must actually fail when `fp()` is missing — test this by temporarily removing the wrapper and asserting the script exits non-zero.
- **TASK-088 (TASK-060a)**: `DELETE /import/trigger/:batchId` race with `scheduled-import` job pickup — `running` state returns 409; `queued` state returns 200. The `cancelled` status is new enum value (type-only, no migration needed).

---

## Review Workload Forecast (per-slice)

| Slice | Code | Tests | Total | Risk | 400L budget |
|-------|------|-------|-------|------|-------------|
| 7b.1a | ~380L | ~180L | ~560L | MED | Slight over (orchestrator approved) |
| 7b.1b | ~320L | ~140L | ~460L | HIGH | At limit |
| 7b.2 | ~330L | ~320L | ~650L | MED | Over (orchestrator approved) |
| **Total** | **~1,030L** | **~640L** | **~1,670L** | — | **3 chained PRs** |

**Cumulative risk after 7b.1a**: MED — lineage + projection packages are isolated, no auth coupling.
**Cumulative risk after 7b.1b**: MED — drift + freshness complete the data plane, still no routes.
**Cumulative risk after 7b.2**: LOW — all 8 routes wired, audit middleware registered, all 4 job bodies swapped.

> Orchestrator has approved chained stacked-to-main delivery. `sdd-apply` should be launched 3 times — one per slice — with each sub-agent getting `strict_tdd`, `chain_strategy=stacked-to-main`, and slice scope in its prompt. Apply-progress should be merged across the 3 sub-agent launches.
