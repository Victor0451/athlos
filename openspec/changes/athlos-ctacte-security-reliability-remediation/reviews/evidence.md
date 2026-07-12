# S0 / PR 1 — focused verification evidence

## Slice
`athlos-ctacte-security-reliability-remediation` / S0 (contracts) / PR 1 of 5
(`stacked-to-main`). Diff is docs + evidence + focused TDD test only.

## Branch / candidate
- branch: `docs/ctacte-security-reliability-s0`
- base: `origin/main` at `eb4c58a50bb143ad5c1d41251383bf567fff70fe`
- worktree: `/home/vlongo/work/athlos-isolated-s0c/`
- lineage_id: `athlos-ctacte-security-reliability-remediation-s0-pr1`

## Lens classification (deterministic)
- tier: **trivial-docs-only**
- required_initial_lenses: **[]** (empty set; deterministic from `policy.md`)
- correction_budget_lines: **0**
- focused verification substitutes for 4R lenses.

## Focused verification evidence

### check-spec-deltas.mjs — six delta specs (always)
```
$ node scripts/check-spec-deltas.mjs
# check-spec-deltas — athlos-ctacte-security-reliability-remediation
# expected capabilities: 6
# valid deltas: 6/6
# summary:
  - api-design: OK req=2 scen=2
  - audit-logger: OK req=2 scen=5
  - auth-login: OK req=1 scen=2
  - database-migrations: OK req=1 scen=2
  - monitoring-observability: OK req=1 scen=2
  - socio-attachments: OK req=1 scen=2
# result: PASS
EXIT=0
```

### 0034 lifecycle — disposable PostgreSQL
Environment: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5555/athlos_test`
(spun up via `docker run --rm -d --name athlos-disposable-pg -p 5555:5432
-e POSTGRES_USER=athlos -e POSTGRES_PASSWORD=athlos -e POSTGRES_DB=athlos_test
postgres:17-alpine`). Container is **disposable**, not production.

```
$ pnpm --filter @athlos/db exec vitest run src/s0-contracts-0034-lifecycle.test.ts
 RUN  v2.1.9 /home/vlongo/work/athlos-isolated-s0c

 ✓ packages/db/src/s0-contracts-0034-lifecycle.test.ts (8 tests) 145ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
EXIT=0
```
8 tests cover: 6 spec-shape validators (one per delta) + 1 RED proof
(`ON CONFLICT` fails without 0034 against the PARTIAL unique index,
SQLSTATE 42P10) + 1 GREEN proof (full chain applies, both expected FULL
UNIQUE INDEXes lack `WHERE`, `ON CONFLICT` infers, `pg_indexes`
snapshot written to `artifacts/0034-lifecycle.txt`).

### TypeScript strict typecheck
```
$ cd packages/db && npx tsc --noEmit
(no output)
EXIT=0
```

## Captured artifacts
- `artifacts/s0-spec-deltas.txt` — six-delta shape validation result.
- `artifacts/0034-lifecycle.txt` — `pg_indexes` snapshot after applying
  the full 0031 → 0032 → 0033 → 0034 chain; asserts both expected FULL
  UNIQUE INDEXes lack a WHERE predicate; asserts `ON CONFLICT
  (idempotency_key)` inference works (`first=1 dup=0 → PASS`).

## Rollback boundary
Slice is **docs + evidence + focused TDD test only**. Reverting this
PR removes:
- `openspec/changes/athlos-ctacte-security-reliability-remediation/`
- `packages/db/src/s0-contracts-0034-lifecycle.test.ts`
- `artifacts/`

No application runtime code, no migrations, no deploy artifacts are
touched. Migration 0034 is already applied in production (since the
prior `athlos-ctacte-mutations` lineage); spec corrections are
forward-only and remain valid after rollback per the explicit policy
in the proposal (`Migration 0034 remains applied under the forward-only
policy`).

## Out of scope (deferred to chained slices)
S1 (auth/validation), S2 (atomic audit/idempotency), S3 (attachment
compensation + actor-bound replay), S4 (timeout/observability) — all
deferred to subsequent PRs in the stacked-to-main chain.
