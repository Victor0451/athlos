# Verification Report — athlos-import-completion

**Change**: athlos-import-completion
**Version**: 0.3.0
**Date**: 2026-06-17
**Mode**: Standard (strict TDD runner not available for enforcement)

---

## Status: CRITICAL

Two CRITICAL issues block archive readiness.

---

## Pre-verify Gate

| Check | Result |
|-------|--------|
| `pnpm test:run` | ✅ 434/434 tests passed |
| `pnpm typecheck` | ✅ Clean — 0 errors |
| `pnpm lint` | ✅ Clean — 0 errors |
| `pnpm test:coverage` | ⚠️ Not available — `@vitest/coverage-v8` not installed |
| CI `ci-check-audit-fp.sh` | ✅ PASS |

---

## Spec Compliance Matrix (8 specs)

| Spec | Status | Evidence |
|------|--------|----------|
| lineage-tracker | ✅ COMPLIANT | `queryLineage` returns 5-field `LineageResponse` (`entity_id`, `source_table`, `source_key`, `content_hash`, `imported_at`, `import_batch`, `audit_event_id`). `verifyHash` returns `HashVerificationResult` with `match`, `stored_hash`, `recomputed_hash`, `verified_at`. Tests: `packages/lineage/src/query.test.ts`, `verify.test.ts`. |
| projection-engine | ✅ COMPLIANT | `rebuildProjection` is idempotent (truncate-then-replay). `computeSaldo` returns `{debe, haber, saldo, as_of}`. `DOMAIN_PROJECTION_TABLE` maps 11 domains. Unknown domain throws `BusinessError(VALIDATION)`. Tests: `rebuild.test.ts`, `saldo.test.ts`. |
| drift-detector | ✅ COMPLIANT | `detect()` uses `IS DISTINCT FROM` for hash comparison. `emitDriftAlert()` writes directly to `audit_events` with `operator_id: null`. Does NOT call `@athlos/audit`. Notification dispatched via `sendNotification('drift_alert', ...)`. Tests: `detect.test.ts`, `alert.test.ts`. |
| freshness-monitor | ✅ COMPLIANT | `DOMAIN_THRESHOLDS` hard-coded in `thresholds.ts` (11 domains, ISO 8601 durations). `getFreshness` maps age → status (`current`/`stale`/`unknown`). Missing domain throws `BusinessError(CONFIG_MISSING)`. `ageDisplay` returns Spanish format. Tests: `thresholds.test.ts`, `api.test.ts`. |
| audit-logger | ✅ COMPLIANT | `auditPlugin` is `fp(auditPluginImpl, { name: 'athlos-audit' })` — verified by `ci-check-audit-fp.sh`. `emitAudit` uses SHA-256 with 10s bucket (`Math.floor(Date.now() / 10_000)`). `queryAudit` paginates with `limit` (default 100, max 500), `page`, `offset`. CI guard exists. Tests: `emitter.test.ts`, `middleware.test.ts`. |
| legacy-import | ✅ COMPLIANT | UUID generation via `getOrCreateEntityUuid` in pipeline. Re-import reuses existing UUID via `onConflictDoNothing` + re-read. `POST /import/trigger` returns 202 + `batchId`. `DELETE /import/trigger/:batchId` cancel semantics: queued→200, running→409, not-found→404, cancelled→200 idempotent. Tests: `pipeline.uuid.test.ts`, `import.test.ts`. |
| notifications | ❌ **CRITICAL FAILURE** | `packages/notifications/src/dispatcher.ts` `resolveDrift()` calls `fetchAdmins()` (role = `'A'`) and returns ADMIN recipients. **Spec requires DATA_STEWARD via `role_permissions` table.** Design §3 §"DATA_STEWARD fanout" shows exact `fetchDataStewards()` implementation using `role_permissions(permission_key = 'data_steward')` — **never wired**. `alert.ts` has comments: "7b.2 updates to role_permissions based routing" — 7b.2 was merged without this change. |
| ui-design | ✅ OK (deferred to PR 8) | No UI work in this change — confirm-and-wait modal is PR 8 territory. API contract (`DELETE /import/trigger/:batchId` server-side cancel) is correctly implemented. |

**Compliance summary**: 7/8 spec deltas fully compliant. 1/8 blocked by CRITICAL spec violation.

---

## Design Compliance (9 sections)

| Section | Status | Notes |
|---------|--------|-------|
| §1 UUID lifecycle | ✅ | `getOrCreateEntityUuid` uses lookup-or-create with `onConflictDoNothing` + re-read. `entity_uuids` table with composite PK. |
| §2 Projection rebuild | ✅ | `DOMAIN_PROJECTION_TABLE` 11 domains. `rebuildProjection` truncate-then-replay. `computeSaldo` cross-domain join implemented. |
| §3 Drift detection | ✅ | `IS DISTINCT FROM` used. Direct `audit_events` write with `operator_id: null`. **DATA_STEWARD fanout NOT implemented** (see CRITICAL). |
| §4 Freshness mapping | ✅ | `DOMAIN_THRESHOLDS` hard-coded. `ageToStatus` logic correct. `ageDisplay` Spanish format. Missing threshold → `CONFIG_MISSING`. |
| §5 Audit middleware | ✅ | `fp(auditPluginImpl, { name: 'athlos-audit' })`. `onResponse` fires only on 2xx. `emitAudit` 10s bucket SHA-256 idempotency. |
| §6 Route surface | ✅ | All 5 routes registered. `POST /import/trigger` (ADMIN, 202). `DELETE /import/trigger/:batchId` (cancel semantics). `GET /drift` + `GET /audit` (ADMIN OR data_steward). |
| §7 DI wiring | ✅ | `container.ts` has `lineageService`, `projectionService`, `driftService`, `freshnessService`, `auditService`, `permissionsRepo`. |
| §8 Job body swap | ✅ | `scheduled-import` calls `runImport` + `rebuildProjection` + `refreshAll`. `drift-detection` calls `detectAll` + `emitDriftAlert`. `freshness-refresh` calls `refreshAll`. `reconciliation` calls `rebuildAll` + `detectAll`. |
| §9 DATA_STEWARD permission wiring | ⚠️ PARTIAL | `role_permissions` table created. `requirePermission('data_steward')` widened to string and checks DB via `permissionsRepo`. **But notifications dispatcher never wired to use it** — the fanout still goes to ADMINs. |

---

## Task Completion (33 tasks)

**Phase 7b.1a** (TASK-061..069): 9/9 checked ✅  
**Phase 7b.1b** (TASK-070..078): 0/9 checked ⚠️ (work was done in PR 7b.1b — commits exist — but tasks.md not updated)  
**Phase 7b.2** (TASK-080..093): 0/14 checked ⚠️ (work was done in PR 7b.2 — commits exist — but tasks.md not updated)

> Tasks.md was not updated after PR 7b.1a merged. The work for 7b.1b and 7b.2 was completed in stacked PRs (commits visible in git log) but the checkbox state in `openspec/changes/athlos-import-completion/tasks.md` was never updated. This is a maintenance issue, not a delivery issue — the implementation is on main.

---

## Migrations (5 total)

| Migration | File | Status |
|-----------|------|--------|
| 0007_entity_uuids | ✅ | Composite PK `(source_table, source_key)`. Unique `entity_uuid`. |
| 0008_drift_snapshots | ✅ | PK = `entity_uuid`. `domain`, `last_hash`, `last_event_id`, `snapshot_at`. |
| 0009_domain_freshness | ✅ | PK = `domain`. `last_import_at`, `record_count`, `refreshed_at`. |
| 0010_role_permissions | ✅ | Composite PK `(operator_id, permission_key)`. FK to `operators`. No default grants. |
| 0011_audit_idempotency_partial_index | ✅ | Partial unique index on `idempotency_key WHERE idempotency_key IS NOT NULL`. |

---

## Out-of-Scope Verification

- ✅ No `auditPlugin` registered without `fp()` wrap (CI guard + source inspection confirms `fp(auditPluginImpl, { name: 'athlos-audit' })`)
- ✅ No UI changes in `apps/web` (PR 8 territory — confirmed absent)
- ✅ No deployment changes (PR 9 territory — confirmed absent)
- ✅ No E2E tests (PR 10b territory — confirmed absent)
- ✅ No `process.cwd()` in tests

---

## Version + Changelog

| Item | Status |
|------|--------|
| `package.json` root version | ✅ `0.3.0` |
| `apps/api/package.json` version | ✅ `0.3.0` |
| `CHANGELOG.md` has `## [0.3.0]` section | ✅ `### Added` and `### Changed` sections present |
| `[0.3.0]` comparison link at bottom | ❌ **MISSING** — spec requires `[0.3.0]: https://github.com/Victor0451/athlos/compare/v0.2.0...v0.3.0` |

---

## 7b.1a + 7b.1b Lesson Adherence

| Lesson | Status |
|--------|--------|
| No `as unknown as never` in tests | ⚠️ FAIL — 12 instances found in `pipeline.uuid.test.ts` (4), `verify.test.ts` (3), `saldo.test.ts` (2), `rebuild.test.ts` (3). Pattern: `} as unknown as never`. These suppress type mismatches in Drizzle mock objects rather than fixing the mock shape. |
| No `process.cwd()` in tests | ✅ Clean — no instances found |
| Drizzle mocks return `{ rows: T[], rowCount: number }` | ⚠️ PARTIAL — `drift/detect.test.ts` uses correct shape. `saldo.test.ts` has `as unknown as never` pattern. |
| Release commits preserved `@athlos/*` workspace deps | ✅ All preserved in `apps/api/package.json` |
| `auditPlugin` is `fastify-plugin` wrapped with `name: 'athlos-audit'` | ✅ Confirmed by `ci-check-audit-fp.sh` |

---

## CRITICAL Issues (BLOCK archive)

1. **[SPEC VIOLATION] Notifications dispatcher sends drift alerts to ADMIN instead of DATA_STEWARD**
   - **File**: `packages/notifications/src/dispatcher.ts`, lines 154–178 (`resolveDrift`)
   - **Problem**: `resolveDrift()` calls `fetchAdmins()` (filters `operators.role = 'A'`) and returns ADMIN recipients. The spec (notifications/spec.md §"Requirement: Notification Trigger — Drift Detected") explicitly requires DATA_STEWARD routing via `role_permissions` table.
   - **Design**: §3 §"DATA_STEWARD fanout" shows the exact `fetchDataStewards()` implementation using `WHERE permission_key = 'data_steward'` — never wired.
   - **Acknowledgment in code**: `alert.ts` (lines 20–23, 55–57) has comments: "7b.2 will update the filter to use role_permissions; in 7b.1b it sends to ADMINs". PR 7b.2 was merged without implementing this.
   - **Impact**: Drift alerts go to ADMIN operators instead of DATA_STEWARD. This is a spec violation — the core intent of OI-1 B (data stewards receive drift alerts, not all admins) is not delivered.
   - **Fix required**: Replace `resolveDrift()` body to call `fetchDataStewards()` instead of `fetchAdmins()`, using the `role_permissions(operator_id, permission_key)` join.

2. **[CHANGELOG] Missing version comparison link**
   - **File**: `CHANGELOG.md`
   - **Problem**: The `[0.3.0]` section exists with `### Added` and `### Changed` content, but the spec requires a comparison link at the bottom: `[0.3.0]: https://github.com/Victor0451/athlos/compare/v0.2.0...v0.3.0`.
   - **Fix required**: Add the comparison URL link at the bottom of CHANGELOG.md.

---

## WARN Issues

3. **[MAINTENANCE] tasks.md not updated after PRs merged**
   - **Problem**: `openspec/changes/athlos-import-completion/tasks.md` shows TASK-070..078 (7b.1b) and TASK-080..093 (7b.2) as unchecked `[ ]`. The work was completed in stacked PRs (commits visible in git log) but the checkboxes were never updated.
   - **Impact**: Low — implementation is on main. Maintenance issue only.
   - **Fix**: Update tasks.md to mark all completed tasks with `[x]`.

4. **[LESSON REGRESSION] `as unknown as never` casts in tests**
   - **Files**: `pipeline.uuid.test.ts` (×4), `verify.test.ts` (×3), `saldo.test.ts` (×2), `rebuild.test.ts` (×3). Also `detect.ts` uses `as unknown as` on `db.execute()` result.
   - **Problem**: 7b.1a lesson: "no `as unknown as never` in tests" was not fully honored. These casts suppress type mismatches in mock objects rather than correcting the mock shape.
   - **Impact**: Low — tests still pass, but the anti-pattern is present.

---

## SUGGESTIONS

- **Add `@vitest/coverage-v8`** to enable coverage gate (the proposal required ≥420 tests with coverage check).
- **Wire `fetchDataStewards()` in the dispatcher** using the `role_permissions` table — this was the design intent and the exact implementation is in design §3.
- **Update tasks.md** to mark all completed tasks with `[x]` for accurate record-keeping.

---

## Recommendation

**FIX CRITICAL ISSUES FIRST**

The notifications DATA_STEWARD routing is a core spec requirement (OI-1 B decision). It cannot be deferred past archive — the `role_permissions` table was created, the `requirePermission('data_steward')` gate was wired, but the actual fanout was never updated. Archive would freeze an incorrect behavior.

Required before archive:
1. Fix `packages/notifications/src/dispatcher.ts` `resolveDrift()` to use `fetchDataStewards()` (design §3 code)
2. Add `[0.3.0]` comparison link to `CHANGELOG.md`

WARN fixes recommended but not blocking:
3. Update tasks.md checkboxes
4. Remove `as unknown as never` casts from tests
