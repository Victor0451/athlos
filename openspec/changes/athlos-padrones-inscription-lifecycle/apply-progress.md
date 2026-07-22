# Apply Progress: Padrones Enrollment Lifecycle

## PR1 — `feat/padrones-schema` → `feat/padrones-inscription-lifecycle`

Completed tasks: 1.1, 1.2, 1.3.

### TDD Cycle Evidence

| Task | Test file | Layer | RED | GREEN | REFACTOR |
|---|---|---|---|---|---|
| 1.1 | `packages/db/src/schema/deportes.test.ts` | PostgreSQL integration | Missing `0036` produced `ENOENT` | 4/4 passed | Fixture helpers prepared |
| 1.2 | `packages/db/src/schema/deportes.test.ts` | PostgreSQL integration | Tests preceded migration/schema changes | 4/4 passed | N/A |
| 1.3 | `packages/db/src/schema/deportes.test.ts` | PostgreSQL integration | N/A — approval baseline: 4/4 passed | 4/4 passed after refactor | Extracted `applyMigration` fixture helper |

### Evidence

- RED command: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/db exec vitest run src/schema/deportes.test.ts`
  - Result: failed because `packages/db/drizzle/0036_padrones_inscription_lifecycle.sql` did not exist (`ENOENT`).
- GREEN command: same command; result: 4 tests passed.
- Post-REFACTOR command: same command; result: 4 tests passed.
- PostgreSQL runtime: disposable local PostgreSQL 16 container `athlos-padrones-schema-test-postgres` on port 5563; verified normalization, atomic unknown-status abort, `baja` metadata and status checks, tuple uniqueness, receipt columns, and migration-log redaction; 4/4 tests passed.
- Focused checks: `pnpm --filter @athlos/db typecheck`, `pnpm --filter @athlos/db lint`, and `pnpm exec prettier --check packages/db/src/schema/deportes.ts packages/db/src/schema/deportes.test.ts packages/db/drizzle/0036_padrones_inscription_lifecycle.sql` all passed.
- Authored changed lines: 350 additions, 0 deletions (including bounded corrections: receipt FKs +30, operator qualification +10, baja metadata +48 after compaction). Generated migration metadata: 0 lines.
- Rollback: retain applied `0036_padrones_inscription_lifecycle.sql`; correct any schema issue only through a later forward migration. UI/routes/services remain untouched.

### Bounded Review Correction — Receipt Foreign Keys

- Scope: added only the missing restrictive foreign keys for `operator_id → operators(id)` and `inscripcion_id → deportes.inscripciones(id)` in `0036` plus real PostgreSQL assertions.
- RED: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/db exec vitest run src/schema/deportes.test.ts` failed: the missing-operator receipt insert resolved instead of rejecting with PostgreSQL `23503`.
- GREEN: same command passed, 5/5 tests.
- Post-cleanup: same command passed, 5/5 tests.
- Runtime boundary: the disposable PostgreSQL test rejects both orphan operator and orphan enrollment receipt inserts with `23503`.
- Focused checks: `pnpm --filter @athlos/db typecheck`, `pnpm --filter @athlos/db lint`, and `pnpm exec prettier --check packages/db/src/schema/deportes.test.ts packages/db/drizzle/0036_padrones_inscription_lifecycle.sql` passed.

### Maintainer-Authorized New Candidate — Operator FK Qualification

- Authority: maintainer authorized a new corrective scope and candidate identity. The escalated ordinary-review lineage `review-a3bc8847cc5828b1` was not resumed or mutated.
- Scope: the current Drizzle schema declares `operators` with `pgTable`, and migration `0001_funny_eternals.sql` references `"public"."operators"("id")`; `0036` now uses that exact restrictive target for `operator_id`.
- RED: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/db exec vitest run src/schema/deportes.test.ts` failed with `relation "operators" does not exist` while the test executed the current operator FK SQL verbatim under the disposable test schema search path.
- GREEN: same command passed, 5/5 tests after schema-qualifying the migration to `"public"."operators"("id")`.
- Post-cleanup: same command passed, 5/5 tests.
- Runtime boundary: production operator FK text is not replaced or rewritten by the test; a disposable `public.operators` table is provisioned, and orphan operator plus orphan enrollment receipt inserts both fail with `23503`.
- Focused checks: `pnpm --filter @athlos/db typecheck`, `pnpm --filter @athlos/db lint`, `pnpm exec prettier --check packages/db/src/schema/deportes.test.ts packages/db/drizzle/0036_padrones_inscription_lifecycle.sql`, and `git diff --check` passed.

### Bounded Correction — Baja Metadata (`review-63c7247e372f9bd7`)

- Scope: corrected only PostgreSQL NULL-safe baja metadata validation and partial historical-baja backfill.
- RED: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/db exec vitest run src/schema/deportes.test.ts` failed because a `baja` row with `baja_motivo NULL` and a date resolved instead of rejecting; partial backfill also replaced `legacy reason` with the sentinel.
- GREEN: same command passed, 6/6 tests.
- Post-cleanup: same command passed, 6/6 tests.
- Runtime boundary: `baja` now requires explicitly non-null reason/date plus a non-blank trimmed reason; partial historical rows retain their existing reason or date while only the missing field is backfilled.
- Exclusions: Drizzle CHECK declaration parity and `CURRENT_DATE` determinism remain informational WARNING follow-ups and were not changed.
- Focused checks: `pnpm --filter @athlos/db typecheck`, `pnpm --filter @athlos/db lint`, `pnpm exec prettier --check packages/db/src/schema/deportes.test.ts packages/db/drizzle/0036_padrones_inscription_lifecycle.sql`, and `git diff --check` passed.
- Cap compaction: removed two non-semantic migration lines without changing assertions or SQL behavior; reran focused PostgreSQL 6/6, typecheck, lint, Prettier, and diff check successfully. The child is now at its 350-addition cap.

## Remaining

PR2–PR7 remain unchecked and out of scope for this child branch.
