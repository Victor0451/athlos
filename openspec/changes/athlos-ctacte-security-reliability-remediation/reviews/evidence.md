# S0 / PR 1 — focused verification evidence
#
# Lineage: athlos-ctacte-security-reliability-remediation-s0-pr1-deterministic-v3
# Built as a NEW native lineage after the v2 escalation. The v2 lineage
# (`athlos-ctacte-security-reliability-remediation-s0-pr1-republish-v2`) was
# never persisted in the v1 authoritative CAS (see Engram #591), so this v3
# lineage reuses the v2 corrected candidate content byte-exactly as a
# starting baseline and adds a single TDD-bounded correction: ensure
# `pgcrypto` is installed BEFORE any `gen_random_uuid()` is referenced in
# `packages/db/src/s0-contracts-0034-lifecycle.test.ts`.

## Slice
`athlos-ctacte-security-reliability-remediation` / S0 (contracts) / PR 1 of 5
(`stacked-to-main`). Diff is docs + evidence + focused TDD test only.

## Branch / candidate
- branch: `docs/ctacte-security-reliability-s0-pr1-deterministic-v3`
- base: `origin/main` at `eb4c58a50bb143ad5c1d41251383bf567fff70fe`
- base tree: `2efd6c5faceed68d9d7a6bbf281bc9e14c6bf9b9`
- worktree: `/home/vlongo/work/athlos-isolated-s0-pr1-deterministic-v3/`
- lineage_id: `athlos-ctacte-security-reliability-remediation-s0-pr1-deterministic-v3`
- v3 authored change vs v2 corrected S0 candidate: 59 lines (budget 400)
- candidate materialized from fixed worktree/source byte-exactly:
  `/home/vlongo/work/athlos-isolated-s0-pr1-republish-v2/` (21 untracked paths)

## Lens classification (deterministic)
- tier: **trivial-docs-only**
- required_initial_lenses: **[]** (empty set; deterministic from `policy.md`)
- correction_budget_lines: **0**
- focused verification substitutes for 4R lenses.

## Focused verification evidence

### check-spec-deltas — six delta specs (always)
The spec-delta checker is colocated with the lifecycle test as the
`S0 contracts: six delta specs conform to Given/When/Then + RFC 2119`
describe block inside `packages/db/src/s0-contracts-0034-lifecycle.test.ts`.
There is no separate `scripts/check-spec-deltas.mjs`; the per-capability
`it()` blocks drive the `validate()` function and emit the same shape
report. Emitted via vitest:
```
$ cd packages/db && pnpm exec vitest run src/s0-contracts-0034-lifecycle.test.ts
 RUN  v2.1.9 /home/vlongo/work/athlos-isolated-s0-pr1-deterministic-v3/packages/db

 ✓ src/s0-contracts-0034-lifecycle.test.ts > S0 contracts: six delta specs conform to Given/When/Then + RFC 2119
   ✓ api-design: shape = OK
   ✓ audit-logger: shape = OK
   ✓ auth-login: shape = OK
   ✓ database-migrations: shape = OK
   ✓ monitoring-observability: shape = OK
   ✓ socio-attachments: shape = OK

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
Environment: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test`
(spun up via `docker run --rm -d --name athlos-disposable-pg-v3 -p 5563:5432
-e POSTGRES_USER=athlos -e POSTGRES_PASSWORD=athlos -e POSTGRES_DB=athlos_test
postgres:17-alpine`). Container is **disposable**, not production.

```
$ cd packages/db && ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@127.0.0.1:5563/athlos_test \
    pnpm exec vitest run src/s0-contracts-0034-lifecycle.test.ts
 RUN  v2.1.9 /home/vlongo/work/athlos-isolated-s0-pr1-deterministic-v3/packages/db

 ✓ src/s0-contracts-0034-lifecycle.test.ts (12 tests) 238ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Duration  530ms

EXIT=0
```

Deterministic — verified by 3 consecutive runs:
- run 1: 12 passed / 530ms
- run 2: 12 passed / 568ms
- run 3: 12 passed / 553ms

12 tests cover:
- 6 spec-shape validators (one per delta)
- 1 frozen-contract test (RENDER_TIMEOUT consistent + concrete operator telemetry)
- 1 rollout-evidence validator (rejects incomplete 0034 chain)
- 1 deterministic-evidence test (asserts no `new Date().toISOString()` in committed test)
- 1 RED proof (ON CONFLICT fails without 0034 against the PARTIAL unique index, SQLSTATE 42P10)
- 1 GREEN proof (full chain applied twice; both expected FULL UNIQUE INDEXes
  lack `WHERE`; `ON CONFLICT` infers; `pg_indexes` snapshot written to
  `artifacts/0034-lifecycle.txt`)
- **1 pgcrypto deterministic prerequisite RED proof (v3 addition)** —
  drops pgcrypto + schemas on fresh PG, spies on `pool.query` execution order
  during `reset()`, asserts `CREATE EXTENSION pgcrypto` runs BEFORE the first
  `CREATE TABLE … gen_random_uuid()`. Confirms the deterministic
  PostgreSQL prerequisite (extension installed first, not last) is enforced.

### TypeScript strict typecheck
```
$ cd packages/db && pnpm exec tsc --noEmit
(no output)
EXIT=0
```

## TDD cycle evidence (v3 delta)
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| v3.1 (pgcrypto deterministic prerequisite) | `packages/db/src/s0-contracts-0034-lifecycle.test.ts` | PostgreSQL integration | ✅ 11/11 baseline | ✅ Written (asserts pgcrypto extension index < first gen_random_uuid table index) | ✅ Passed (12/12) | ➖ Single — order has only two states (correct/incorrect) | ✅ Code moved `CREATE EXTENSION pgcrypto` to be the first statement in `reset()` |

## Captured artifacts
- `artifacts/s0-spec-deltas.txt` — six-delta shape validation result (deterministic).
- `artifacts/0034-lifecycle.txt` — `pg_indexes` snapshot after applying
  the full 0031 → 0032 → 0033 → 0034 chain twice; asserts both expected
  FULL UNIQUE INDEXes lack a WHERE predicate; asserts `ON CONFLICT
  (idempotency_key)` inference works (`first=1 dup=0 → PASS` for both runs).

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
