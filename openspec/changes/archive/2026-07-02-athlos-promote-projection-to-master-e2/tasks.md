# Tasks: athlos-promote-projection-to-master-e2

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e2` |
| **Date** | 2026-06-25 |
| **Phase** | Tasks |
| **Mode** | Both (OpenSpec file + Engram topic) |
| **Status** | Ready for apply |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e2/tasks.md` |
| **Source artifacts** | `openspec/changes/athlos-promote-projection-to-master-e2/design.md` · `openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md` |
| **Target release** | v0.5.5 → **v0.5.6** (PATCH — closes Slice E permanently) |
| **Commit shape** | 3 commits: `feat(promotion+api)` → `docs(spec+runbook)` → `chore(release): v0.5.6` |
| **TDD chain** | TASK-001 [RED] → TASK-002..006 [GREEN] → TASK-007 [REFACTOR] |

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated raw changed lines | **~485** |
| Estimated effective changed lines | **~280** |
| Per-PR target | ≤ 400 |
| 400-line budget risk | **MEDIUM** — raw ~121%, effective ~70% |
| Chained PRs recommended | **NO** — 4 tightly coupled deliverables + Slice E is LAST sub-slice |
| Decision needed before apply | **NO** — all decisions locked in design |

### Commit breakdown

| Commit | Tasks | Est. raw | Est. effective |
|--------|-------|----------|----------------|
| `feat(promotion+api): add admin promote trigger + promoted_at audit` | TASK-001..TASK-008 | ~380 | ~220 |
| `docs(spec+runbook): final atomic sync closes Slice E` | TASK-009..TASK-010 | ~120 | ~80 |
| `chore(release): v0.5.6` | TASK-011..TASK-012 | ~20 | ~15 |
| **Total** | **12 tasks** | **~485** | **~280** |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending (single PR — no chained PRs)
400-line budget risk: Medium

---

## TASK-001 — TDD-RED: Write 6 admin endpoint tests

| Field | Value |
|-------|-------|
| **ID** | `TASK-001` |
| **Type** | `TDD-RED` |
| **Phase** | RED (write tests before implementation) |
| **Dependencies** | None (first task) |
| **Files to create** | `apps/api/src/routes/promote.test.ts` |

### What

Write 6 vitest test cases (T1–T6) in `apps/api/src/routes/promote.test.ts`. Tests use **mock container pattern** (Fastify `app.inject` + mock `@athlos/promotion` module — NO real DB write, mirrors `import.test.ts:1-100` per E1b2a LESSON).

### Test cases

| # | Case | Setup | Assertion |
|---|------|-------|-----------|
| **T1** | ADMIN → 200 OK | Valid ADMIN JWT, `POST /api/v1/promote/trigger {}` | `statusCode === 200`, `body.status === 'completed'`, `body.domains` array present |
| **T2** | CONSULTA → 403 | CONSULTA role JWT, same request | `statusCode === 403` |
| **T3** | Unauthenticated → 401 | No Authorization header | `statusCode === 401` |
| **T4** | Rate-limited → 429 | ADMIN JWT, 2nd request within 1 min | `statusCode === 429`, `Retry-After` header present |
| **T5** | Concurrent → 200 `already_running` | `container.promotionInFlight = true` before request | `statusCode === 200`, `body.status === 'already_running'` |
| **T6** | GET status → 200 | ADMIN JWT, `GET /api/v1/promote/status` | `statusCode === 200`, `body.runs` array present |

### Mock setup

```typescript
vi.mock('@athlos/promotion', () => ({
  promoteAll: vi.fn().mockResolvedValue([{ domain: 'socios', attempted: 100, inserted: 50, skipped: 50, failed: 0, errors: [], durationMs: 100 }]),
  promoteDomain: vi.fn().mockImplementation((_db, domain) => ({ domain, attempted: 100, inserted: 50, skipped: 50, failed: 0, errors: [], durationMs: 100 })),
  PROMOTION_ORDER: ['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1'],
}))
```

### Verification step

```bash
pnpm --filter @athlos/api test:run -- apps/api/src/routes/promote.test.ts
```
Expected: **6 failures** (RED) — `promote.ts` route does not exist yet.

### Commit shape

- **Commit 1**: `feat(promotion+api): add admin promote trigger + promoted_at audit`

### Rollback note

Delete `apps/api/src/routes/promote.test.ts`. No other files depend on it.

---

## TASK-002 — TDD-GREEN: Migration 0016 — hand-write + apply via psql

| Field | Value |
|-------|-------|
| **ID** | `TASK-002` |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written) |
| **Files to create** | `packages/db/drizzle/0016_promoted_at.sql` |
| **Files to modify** | `packages/db/drizzle/meta/_journal.json` |

### What

Hand-write `0016_promoted_at.sql` (ALTER TABLE + INDEX + `socios`-only backfill, single tx + statement_timeout). Apply via `psql` (NOT drizzle-kit per E1b1 LESSON). Update `_journal.json` to add idx 16 entry.

### Files to create

#### `packages/db/drizzle/0016_promoted_at.sql` (~20L)

```sql
-- Migration 0016: raw_events.promoted_at audit column (E2 — Slice E closure)
-- Per-row idempotency tracking. Belt-and-suspenders with master.legacy_id UNIQUE INDEX.
-- Backfill: socios ONLY in v1 (~16,383 rows).
-- ctacte/ctacte1 backfill deferred to E3+ (requires raw_events.legacy_id).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + WHERE promoted_at IS NULL.

BEGIN;
SET LOCAL statement_timeout = '60s';

ALTER TABLE "public"."raw_events"
  ADD COLUMN IF NOT EXISTS "promoted_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_events_promoted_at_idx"
  ON "public"."raw_events" ("promoted_at");
--> statement-breakpoint
UPDATE "public"."raw_events" re
SET "promoted_at" = now()
FROM "socios"."socios" s
WHERE re.source_table = 'socios'
  AND re.source_key = s.numero_socio
  AND re.promoted_at IS NULL;
COMMIT;
```

### Files to modify

#### `packages/db/drizzle/meta/_journal.json`

Append idx 16 entry:

```json
{ "idx": 16, "version": "7", "when": 1782341000000, "tag": "0016_promoted_at", "breakpoints": true }
```

### Verification step

```bash
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "\d public.raw_events"  # promoted_at column + idx present
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "SELECT count(*) FROM public.raw_events WHERE source_table='socios' AND promoted_at IS NOT NULL;"  # expect ~16,383
jq '.entries[-1].tag' packages/db/drizzle/meta/_journal.json  # expect "0016_promoted_at"
```

### Commit shape

- **Commit 1**: `feat(promotion+api): add admin promote trigger + promoted_at audit`

### Rollback note

```sql
ALTER TABLE public.raw_events DROP COLUMN IF EXISTS promoted_at;
DROP INDEX IF EXISTS raw_events_promoted_at_idx;
```
Revert `_journal.json` entry for idx 16.

---

## TASK-003 — TDD-GREEN: Schema — add `promotedAt` to `rawEvents`

| Field | Value |
|-------|-------|
| **ID** | `TASK-003` |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-002 (migration applied) |
| **Files to modify** | `packages/db/src/schema/public.ts` |

### What

Add `promotedAt: timestamp('promoted_at', { withTimezone: true })` column + `promotedAtIdx` index to `rawEvents` table in `public.ts`.

### Verification step

```bash
pnpm --filter @athlos/db typecheck
grep "promotedAt" packages/db/src/schema/public.ts  # expect ≥3 hits (column + index + type)
```

### Commit shape

- **Commit 1**: `feat(promotion+api): add admin promote trigger + promoted_at audit`

### Rollback note

Revert `public.ts` changes. Drizzle schema only — no migration to rollback (migration applied via psql in TASK-002).

---

## TASK-004 — TDD-GREEN: Admin endpoint — route + wiring

| Field | Value |
|-------|-------|
| **ID** | `TASK-004` |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written) |
| **Files to create** | `apps/api/src/routes/promote.ts` |
| **Files to modify** | `apps/api/src/server.ts`, `apps/api/src/container.ts` |

### What

Create `apps/api/src/routes/promote.ts` with:
- `POST /api/v1/promote/trigger` (ADMIN, per-operator 1/min rate limit, 120s timeout, sync `promoteAll`)
- `GET /api/v1/promote/status` (ADMIN, last 20 `audit_events` rows where `action = 'PROMOTE_TRIGGER'`)
- Concurrent-trigger guard via `container.promotionInFlight` flag (reset in `finally`)
- Audit emission via `emitAudit`

Register in `server.ts` (after `importRoutes`, before `lineageRoutes`). Add `promotionInFlight: boolean` to `AppContainer` interface.

### Verification step

```bash
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/api test:run -- apps/api/src/routes/promote.test.ts
# Expect: 6 tests PASS (GREEN)
```

### Commit shape

- **Commit 1**: `feat(promotion+api): add admin promote trigger + promoted_at audit`

### Rollback note

Delete `apps/api/src/routes/promote.ts`. Revert `server.ts` + `container.ts` changes.

---

## TASK-005 — TDD-GREEN: Update `promote.ts` — `promoted_at` filter + bulk UPDATE

| Field | Value |
|-------|-------|
| **ID** | `TASK-005` |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-002 (migration applied), TASK-003 (schema updated) |
| **Files to modify** | `packages/promotion/src/promote.ts` |

### What

In `promoteDomain()`:
1. Replace projection scan with JOIN: `JOIN public.raw_events re ON re.source_table = $domain AND re.source_key = pe.source_key AND re.promoted_at IS NULL`
2. Add `insertedSourceKeys: string[]` buffer to track successfully-inserted keys
3. After all batches flush, bulk `UPDATE public.raw_events SET promoted_at = now() WHERE source_table = $domain AND source_key = ANY($insertedKeys::varchar[])`

### Verification step

```bash
pnpm --filter @athlos/promotion typecheck
grep -A 3 "JOIN public.raw_events" packages/promotion/src/promote.ts  # JOIN clause present
grep -A 3 "UPDATE public.raw_events" packages/promotion/src/promote.ts  # bulk UPDATE present
```

### Commit shape

- **Commit 1**: `feat(promotion+api): add admin promote trigger + promoted_at audit`

### Rollback note

Revert `promote.ts` changes. Restores previous projection scan.

---

## TASK-006 — TDD-GREEN: Update `dedup.ts` — ctacte/ctacte1 cross-check

| Field | Value |
|-------|-------|
| **ID** | `TASK-006` |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-002 (migration applied) |
| **Files to modify** | `packages/promotion/src/dedup.ts`, `packages/promotion/src/index.ts` |

### What

In `loadExistingNaturalKeys()` for `ctacte` and `ctacte1` ONLY: additionally read `SELECT source_key FROM public.raw_events WHERE source_table = $domain AND promoted_at IS NOT NULL` and union with the `master.legacy_id` set.

Ensure `PROMOTION_ORDER` is re-exported from `index.ts` (admin route imports it).

### Verification step

```bash
pnpm --filter @athlos/promotion typecheck
grep -A 5 "domain === 'ctacte'" packages/promotion/src/dedup.ts  # both legacy_id + promoted_at reads
grep "PROMOTION_ORDER" packages/promotion/src/index.ts  # re-export present
```

### Commit shape

- **Commit 1**: `feat(promotion+api): add admin promote trigger + promoted_at audit`

### Rollback note

Revert `dedup.ts` + `index.ts` changes.

---

## TASK-007 — TDD-REFACTOR: Tighten helpers, remove `any`

| Field | Value |
|-------|-------|
| **ID** | `TASK-007` |
| **Type** | `TDD-REFACTOR` |
| **Phase** | REFACTOR |
| **Dependencies** | TASK-004 (endpoint green), TASK-005 (promote green), TASK-006 (dedup green) |
| **Files to modify** | Any in `packages/promotion/src/`, `apps/api/src/routes/promote.ts` |

### What

- Remove any `as any` casts or `eslint-disable` comments no longer needed
- Ensure all imports are consistent
- Verify all 6 new endpoint tests still pass

### Verification step

```bash
pnpm --filter @athlos/api test:run -- apps/api/src/routes/promote.test.ts
pnpm test:run
pnpm typecheck
pnpm lint
# Expected: all pass
```

### Commit shape

- **Commit 1**: `feat(promotion+api): add admin promote trigger + promoted_at audit` (same commit, refactor is cleanup phase within TDD cycle)

### Rollback note

Refactor only — revert to pre-refactor state of same files.

---

## TASK-008 — Pre-closing verification — CRITICAL E1b1/E1b2a/E1b2b LESSON

| Field | Value |
|-------|-------|
| **ID** | `TASK-008` |
| **Type** | `verification` |
| **Phase** | smoke test |
| **Dependencies** | TASK-001..TASK-007 (everything wired) |
| **Files to modify** | None |

### What

Run the full end-to-end verification. **CRITICAL: `bash scripts/verify-slice.sh` is the non-negotiable pre-merge gate** (per E1b1/E1b2a/E1b2b LESSON from commit `b26896c`).

### Steps

```bash
# 1. Migration 0016 already applied via TASK-002 — verify
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "SELECT count(*) FROM public.raw_events WHERE source_table='socios' AND promoted_at IS NOT NULL;"  # expect ~16,383

# 2. Full suite — no regression
pnpm test:run  # (E1b2a tests skipped per commit b26896c)

# 3. Typecheck
pnpm typecheck  # 0 errors

# 4. Lint
pnpm lint  # 0 errors

# 5. CRITICAL GATE: verify-slice.sh (E1b1/E1b2a/E1b2b LESSON — non-negotiable)
bash scripts/verify-slice.sh
# Expected: exit 0 (PASS)
# Output MUST show 8 master tables, idempotency verified (2nd run inserts 0 rows)
```

### Verification step

All steps above MUST pass. **No merge until `bash scripts/verify-slice.sh` exits 0.**

### Commit shape

No files — verification only. Marks the end of Commit 1.

### Rollback note

Truncate affected tables and re-run promotion if needed.

---

## TASK-009 — Runbook update

| Field | Value |
|-------|-------|
| **ID** | `TASK-009` |
| **Type** | `docs` |
| **Phase** | documentation |
| **Dependencies** | TASK-008 (feat work complete) |
| **Files to modify** | `docs/runbook.md` |

### What

Add new top-level "Promotion Pipeline" section to `docs/runbook.md` **between** "Containerized Deploy (Docker)" (ends ~line 295) and "CI/CD" (starts line 297).

6 sub-sections:
1. How to run promotion (CLI vs API)
2. The 8 master tables + their natural keys
3. The `promoted_at` audit column
4. Cross-run idempotency contract
5. Admin API: `POST /api/v1/promote/trigger`
6. Known Limitations (N7, N8, N14, N16)

### Verification step

```bash
grep -n "^## " docs/runbook.md  # expect 7 sections (was 6; +1 for Promotion Pipeline)
grep -n "Promotion Pipeline\|promote/trigger\|promoted_at" docs/runbook.md  # expect ≥3 hits
wc -l docs/runbook.md  # expect ~433 (was 343)
```

### Commit shape

- **Commit 2**: `docs(spec+runbook): final atomic sync closes Slice E`

### Rollback note

Revert the "Promotion Pipeline" section from `docs/runbook.md`.

---

## TASK-010 — FINAL atomic canonical spec sync — B1b LESSON #1 (HIGHEST)

| Field | Value |
|-------|-------|
| **ID** | `TASK-010` |
| **Type** | `docs` |
| **Phase** | spec sync |
| **Dependencies** | TASK-008 (feat work complete) |
| **Files to modify** | `openspec/specs/deployment-devops/spec.md` |

### What

**APPEND ONLY** (NOT modifying existing content). Add 3 NEW requirements after `tesoreria.gastos` requirement (after line 315):

1. **Requirement: Admin Promotion Trigger** (7 scenarios)
2. **Requirement: Per-row Promotion Audit (`promoted_at`)** (6 scenarios)
3. **Requirement: Runbook Documentation** (5 scenarios)

Add 3 NEW success criteria (#49-51):
- `bash scripts/verify-slice.sh` exits 0
- `POST /api/v1/promote/trigger` returns 200 idempotent
- `SELECT count(*) FROM raw_events WHERE promoted_at IS NOT NULL` shows ~16,383

**Existing Promotion Pipeline requirement (lines 167-276) and `tesoreria.gastos` requirement (lines 280-315) MUST remain UNCHANGED.**

### Diff verification (CRITICAL — B1b LESSON #1 enforcement)

```bash
diff -u \
  <(grep -A 500 "Promotion Pipeline" openspec/specs/deployment-devops/spec.md) \
  <(grep -A 500 "Promotion Pipeline" openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md) | head -100
```
Expected: **additive-only changes** (~80 lines of new spec content). No removals of pre-Slice E scenarios.

If diff shows removals: **STOP**, surface drift, fix canonical BEFORE proceeding.

### Commit shape

- **Commit 2**: `docs(spec+runbook): final atomic sync closes Slice E`

### Rollback note

Revert appended 3 requirements + 3 success criteria from canonical spec.

---

## TASK-011 — Pre-merge fix slot — B1b LESSON #3

| Field | Value |
|-------|-------|
| **ID** | `TASK-011` |
| **Type** | `chore` |
| **Phase** | pre-merge |
| **Dependencies** | TASK-010 (spec synced) |
| **Files to modify** | Varies |

### What

If any pre-merge check (TASK-008) catches an issue:
1. Apply the fix
2. **Cherry-pick reorder** to preserve 3-commit shape

### Pre-merge checklist

- [ ] `bash scripts/verify-slice.sh` → **exit 0 (PASS)** — CRITICAL GATE
- [ ] `pnpm typecheck` → 0 errors
- [ ] `pnpm lint` → 0 errors
- [ ] TASK-010 diff verification → additive-only
- [ ] All new files have conventional commit messages
- [ ] No `Co-Authored-By` in any commit
- [ ] **Merge to `main` BEFORE `git branch -D`** (B1b LESSON #4)

### Commit shape

No new commit if no fix needed. If a fix is applied, cherry-pick reorder to preserve 3-commit shape.

### Rollback note

Revert the applied fix. Re-order commits via rebase if cherry-pick reorder was used.

---

## TASK-012 — Closing release commit — B1b LESSON #2

| Field | Value |
|-------|-------|
| **ID** | `TASK-012` |
| **Type** | `chore` |
| **Phase** | release |
| **Dependencies** | TASK-011 (pre-merge checks green) |
| **Files to modify** | Root `package.json`, `packages/promotion/package.json`, 16 other `packages/*/package.json`, `CHANGELOG.md` |

### What

Bump version from `0.5.5` → `0.5.6` in ALL workspace packages. **In a SEPARATE commit from the feat commit** (B1b LESSON #2).

### Version bump (ALL 18 packages)

```bash
# Root + packages/promotion + 16 other packages
# Each: "version": "0.5.5" → "0.5.6"
```

### CHANGELOG.md addition

```markdown
## [0.5.6] — 2026-06-25

### Added

- **Admin API endpoint** `POST /api/v1/promote/trigger` (ADMIN, per-operator 1/min rate limit, sync HTTP, 120s timeout) + `GET /api/v1/promote/status` (last 20 runs)
- **`raw_events.promoted_at`** audit column (migration 0016) + `socios`-only backfill (~16,383 rows)
- **`promote.ts`** filters projection via `JOIN raw_events WHERE promoted_at IS NULL` + bulk UPDATE on success
- **`dedup.ts`** cross-check for ctacte/ctacte1 via `raw_events.promoted_at`
- **Runbook** new "Promotion Pipeline" section (CLI vs API, 8 master tables + NKs, idempotency contract, Admin API, Known Limitations)
- **Canonical spec** 3 NEW additive requirements (Admin Promotion Trigger, Per-row Audit, Runbook) + 3 NEW success criteria (#49-51)

### Spec

- `openspec/specs/deployment-devops/spec.md` — FINAL atomic sync (B1b LESSON #1): 3 NEW additive requirements + 13 NEW scenarios + 3 NEW success criteria (#49-51). Slice E closed permanently.
```

### Verification step

```bash
git log --oneline -3
# Expected:
# abc1234 chore(release): v0.5.6
# def5678 docs(spec+runbook): final atomic sync closes Slice E
# 9876543 feat(promotion+api): add admin promote trigger + promoted_at audit

grep -r '"version"' packages/*/package.json package.json | grep -v 0.5.6
# Expected: 0 output (all packages at 0.5.6)

grep "0.5.6" CHANGELOG.md | wc -l
# Expected: ≥ 1
```

### Commit shape

- **Commit 3**: `chore(release): v0.5.6` (separate from feat — B1b LESSON #2)

### Rollback note

Revert version changes in all 19 `package.json` files + remove the CHANGELOG entry.

---

## Commit shape summary

```
Commit 1: feat(promotion+api): add admin promote trigger + promoted_at audit
  ├── TASK-001 (TDD-RED): 6 admin endpoint tests (mock container)
  ├── TASK-002 (TDD-GREEN): migration 0016 hand-written + applied via psql
  ├── TASK-003 (TDD-GREEN): schema — promotedAt column on rawEvents
  ├── TASK-004 (TDD-GREEN): admin endpoint (POST trigger + GET status) + wiring
  ├── TASK-005 (TDD-GREEN): promote.ts — promoted_at filter + bulk UPDATE
  ├── TASK-006 (TDD-GREEN): dedup.ts — ctacte/ctacte1 cross-check
  ├── TASK-007 (TDD-REFACTOR): tighten helpers, remove any
  └── TASK-008 (smoke test): bash scripts/verify-slice.sh PASS ← CRITICAL GATE

Commit 2: docs(spec+runbook): final atomic sync closes Slice E
  ├── TASK-009 (runbook): "Promotion Pipeline" section + 6 sub-sections
  └── TASK-010 (spec sync): 3 NEW requirements + 3 NEW criteria (#49-51) — ADDITIVE ONLY

Commit 3: chore(release): v0.5.6
  └── TASK-012 (release): version bump 0.5.5 → 0.5.6 + CHANGELOG entry

# TASK-011 is a fix slot (no commit if no fix needed)
```

---

## LESSONs from B1b + E1b1/E1b2a/E1b2b (embedded)

| # | LESSON | Where applied |
|---|--------|---------------|
| **B1b #1 (HIGHEST)** | **Additive-only atomic sync** — 3 NEW requirements APPENDED, existing Promotion Pipeline UNCHANGED; diff returns ONLY additive changes | TASK-010 |
| **B1b #2** | **Separate release commit** — version bump + CHANGELOG in `chore(release): v0.5.6`, NOT in feat commit | TASK-012 |
| **B1b #3** | **Cherry-pick reorder** if pre-merge fix needed | TASK-011 |
| **B1b #4** | **Merge before delete** — merge feature branch to `main` BEFORE `git branch -D` | TASK-011 |
| **E1b1/E1b2a/E1b2b** | **`bash scripts/verify-slice.sh` is the REAL gate** — non-negotiable per commit b26896c | TASK-008 |
| **E1b1** | **Migration via psql** — NOT drizzle-kit migrate (journal tracking mismatch) | TASK-002 |
| **E1b2a** | **Admin endpoint tests use mock container** — no real DB write; mirrors import.test.ts | TASK-001 |
| **E1b2b** | **describe.skip for promote.test.ts** — TRUNCATE bug fix; verify-slice.sh is REAL gate | TASK-008 |

---

## Next Step

Ready for `sdd-apply` — execute TDD chain (TASK-001 RED → TASK-002..006 GREEN → TASK-007 REFACTOR) then smoke test + spec sync.

