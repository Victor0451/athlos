# Tasks — `athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill`

**Change**: E3 (closes N14 limitation)
**Target**: v0.5.6 → v0.5.7 PATCH
**Forecast**: ~280 raw / ~180 effective LoC (under 400-line budget)

## CRITICAL: Hash parity gate

The `deterministicUuid()` function in TypeScript (`packages/promotion/src/transform-helpers.ts`) and the `promotion_deterministic_uuid()` SQL function in Migration 0018 MUST produce byte-for-byte identical UUIDs for the same natural key input. Any mismatch → silent re-inserts on cross-run.

**TASK-001 (hash parity test) is the HARD GATE.** If parity fails, Migration 0018 MUST be rejected.

## TASK LIST

### TASK-001 [TDD-RED] — HASH PARITY TEST (CRITICAL GATE)
**File**: `packages/promotion/src/__tests__/uuid-parity.test.ts` (NEW)
**Dependencies**: none
**Commit**: 1 (feat)
**Verification**:
1. Define 5 known input natural keys (1 ctacte + 1 ctacte1 + 3 random)
2. Compute expected UUIDs via `deterministicUuid()` (TypeScript)
3. After migration 0018 applied, query `SELECT promotion_deterministic_uuid($1)` via psql
4. Assert byte-for-byte equality for all 5 inputs
5. **Test MUST pass BEFORE applying migration 0018**

**Rollback**: N/A (test file only)

### TASK-002 [TDD-GREEN migration 0017]
**File**: `packages/db/drizzle/0017_raw_events_legacy_id.sql` (NEW)
**Dependencies**: TASK-001
**Commit**: 1 (feat)
**Verification**:
- Apply via `psql`: `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0017_raw_events_legacy_id.sql`
- Update `meta/_journal.json` (add idx 17 entry with hash)
- Verify: `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='raw_events' AND column_name='legacy_id';` returns 1 row
- Verify: `\di raw_events_legacy_id_unique` shows UNIQUE INDEX
- Idempotency: re-run the migration — should be no-op

**Rollback**: `ALTER TABLE public.raw_events DROP COLUMN IF EXISTS legacy_id; DROP INDEX IF EXISTS raw_events_legacy_id_unique;`

### TASK-003 [TDD-GREEN schema]
**File**: `packages/db/src/schema/public.ts` (MODIFIED)
**Dependencies**: TASK-002
**Commit**: 1 (feat)
**Verification**:
- Add `legacyId: text('legacy_id')` to `rawEvents` schema definition
- Run `pnpm typecheck` — clean

### TASK-004 [TDD-GREEN migration 0018] — pgcrypto + backfill + function
**File**: `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` (NEW)
**Dependencies**: TASK-001 (parity), TASK-002 (column)
**Commit**: 1 (feat)
**Verification**:
- Apply via `psql`: `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql`
- Update `meta/_journal.json` (add idx 18 entry)
- Verify: `SELECT count(*) FROM public.raw_events WHERE legacy_id IS NOT NULL AND source_table IN ('ctacte', 'ctacte1');` returns ~571,000 rows
- Verify: `SELECT count(*) FROM public.raw_events WHERE legacy_id IS NULL AND source_table IN ('ctacte', 'ctacte1');` returns ~1,000 rows (the CCTCUENTA=0 sentinels that fail FK lookup)
- Idempotency: re-run — should be no-op (UPDATE has `WHERE legacy_id IS NULL`)

**Rollback**: `DROP FUNCTION IF EXISTS promotion_deterministic_uuid(text); UPDATE public.raw_events SET legacy_id = NULL WHERE legacy_id IS NOT NULL;`

### TASK-005 [TDD-GREEN promote.ts] — raw_events-direct path
**File**: `packages/promotion/src/promote.ts` (MODIFIED)
**Dependencies**: TASK-002, TASK-004
**Commit**: 1 (feat)
**Verification**:
- `promoteDomain('ctacte'|'ctacte1')` reads DIRECTLY from `public.raw_events` (NOT from `*_projection`)
- Filter: `WHERE source_table = $domain AND (legacy_id IS NULL OR promoted_at IS NULL)`
- After successful INSERT: bulk UPDATE `public.raw_events SET promoted_at = now() WHERE id = ANY($insertedRawEventIds)`
- Other 6 domains unchanged
- Run `pnpm typecheck` — clean
- Run `pnpm test:run` — tests pass

### TASK-006 [TDD-GREEN dedup.ts] — read from raw_events.legacy_id
**File**: `packages/promotion/src/dedup.ts` (MODIFIED)
**Dependencies**: TASK-002, TASK-004
**Commit**: 1 (feat)
**Verification**:
- `loadExistingNaturalKeys('ctacte'|'ctacte1')` reads from `public.raw_events.legacy_id`
- Returns Set of legacy_ids from raw_events (NOT master)
- Other 6 domains unchanged
- Run `pnpm typecheck` — clean

### TASK-007 [TDD-REFACTOR]
**Files**: `packages/promotion/src/promote.ts`, `packages/promotion/src/dedup.ts`
**Dependencies**: TASK-005, TASK-006
**Commit**: 1 (feat)
**Verification**:
- Clean up code: remove unused imports, eslint-disable comments
- Run `pnpm lint` — clean

### TASK-008 [pre-closing verification — VERIFY-SLICE.SH MANDATORY GATE]
**Files**: `scripts/verify-slice.sh` (MODIFIED — add NEW Step 7)
**Dependencies**: TASK-001..TASK-007
**Commit**: 1 (feat) — add NEW Step 7 + verify all other steps still pass

**Verification**:
1. Run `pnpm test:run` — full suite passes
2. Run `pnpm lint` — clean
3. Run `pnpm typecheck` — clean
4. **RUN `bash scripts/verify-slice.sh`** — MUST exit 0 (PASS). REAL gate per E1b/E2 LESSON.
5. NEW Step 7 assertion: ctacte1 count ≥ 215,000 (88% of 245,370 projection rows)
6. NEW Step 7 assertion: raw_events.legacy_id populated for ≥ 400,000 ctacte+ctacte1 rows
7. If exit != 0, fix and re-run. Surface to orchestrator.

### TASK-009 [docs — runbook + canonical sync]
**Files**: `docs/runbook.md` (MODIFIED), `openspec/specs/deployment-devops/spec.md` (MODIFIED)
**Dependencies**: TASK-008
**Commit**: 2 (docs)
**Verification**:
- Remove N14 from `docs/runbook.md` "Known Limitations" section
- Add note about E3 closing N14
- UPDATE `openspec/specs/deployment-devops/spec.md` "Per-row Promotion Audit (`promoted_at`)" scenario to reflect E3 changes (raw_events.legacy_id + ctacte/ctacte1 direct path)
- ADD NEW scenario for ctacte1 promotion rate ≥88%
- Run diff verification (additive-only per B1b LESSON #1):
  ```bash
  diff <(grep -A 500 "Promotion Pipeline" openspec/specs/deployment-devops/spec.md) <(grep -A 500 "Promotion Pipeline" openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md) | head -100
  ```
- Diff SHALL be ADDITIVE only (UPDATE Per-row Promotion Audit scenario + ADD NEW scenario for ≥88% rate)

### TASK-010 [release commit]
**Files**: `package.json` (MODIFIED), `packages/promotion/package.json` (MODIFIED), `CHANGELOG.md` (MODIFIED)
**Dependencies**: TASK-009
**Commit**: 3 (release)
**Verification**:
- Bump `package.json`: 0.5.6 → 0.5.7
- Bump `packages/promotion/package.json`: 0.5.6 → 0.5.7
- Other packages: maintain current versions (no version drift per E1b2b fix)
- Add CHANGELOG v0.5.7 entry
- **DO NOT bump apps/api/package.json** (it's still 0.5.0 — pre-existing drift, fix deferred)

## Commit Shape (3 commits)

1. `feat(promotion): E3 ctacte/ctacte1 backfill via raw_events.legacy_id` — TASK-001..TASK-007
2. `docs(spec+runbook): remove N14 + update Per-row Promotion Audit` — TASK-009
3. `chore(release): v0.5.7` — TASK-010

## LESSONs (MUST apply)

- **B1b LESSON #1 (HIGHEST)**: TASK-009 atomic canonical sync — additive-only diff verification
- **B1b LESSON #2**: TASK-010 separate release commit
- **B1b LESSON #3**: pre-merge fix slot
- **B1b LESSON #4**: merge feature branch to main BEFORE `git branch -D`
- **E1b/E2 LESSON (CRITICAL)**: TASK-008 MUST include `bash scripts/verify-slice.sh` — REAL gate
- **NEW E3 LESSON (CRITICAL)**: TASK-001 hash parity test is the GATE for migration 0018 — apply sub-agent MUST verify byte-for-byte equality BEFORE applying 0018
- **E2 LESSON (UNFIXED)**: apply sub-agents don't save to engram — orchestrator must verify mem_save exists after apply

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Raw LoC | ~280 |
| Effective LoC | ~180 |
| Budget risk | LOW (under 400) |
| Chained PRs | NO (single slice) |
| Decision needed before apply | NO |