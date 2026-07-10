# Apply Progress — athlos-ctacte-mutations R2b batch

**Mode**: Strict TDD
**Branch**: `fix/ctacte-mutations-r2b`
**Base**: `origin/main` after PR #31 merge (`b400f99`)
**Scope**: Close R2.5 strict-TDD evidence in `apply-progress.md` for R2.1–R2.4; capture disposable-PostgreSQL replay evidence; record the safe 0031→0032→0033 runbook migration readiness. No production code is modified by this branch; no production database or container is touched.

## Final implementation commit

- `docs(sdd): close R2.5 strict-TDD evidence and capture disposable-PostgreSQL replay runs`

## TDD Cycle Evidence (R2.1 – R2.4)

Each row records the cited pre-change commit, the exact RED command (or `MISSING` when the original RED run is not re-executable in this branch), the implementation commit(s), the exact GREEN command + exit code + pass count, the triangulation cases, and the safety net. Per the R2.5 task description, RED evidence that cannot be cited today is explicitly recorded as `MISSING` — never fabricated.

### R2.1 — Comprobante replay (golden helper + durable lease state machine)

| Field | Value |
|---|---|
| Pre-change commit | `df1ae2c docs(sdd): record R2a lease evidence` |
| RED command | MISSING — original R2a RED run was coupled with the production change in `088a56e fix(ctacte): enforce replay request identity` (test + production landed together); the split pre-change state is not reproducible in this branch |
| Implementation commit | `14b769c fix(ctacte): enforce durable comprobante leases`; subsequent refinements `b403e7c fix(ctacte): guard replay reclaim identity`; merged into `main` via PR #31 (`b400f99`) |
| GREEN command | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:55433/athlos pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts src/modules/socios/forms/ctacte-comprobante.lease.test.ts src/modules/socios/forms/ctacte-comprobante.golden.test.ts` — exit 0, **11/11** (4 PG + 3 lease + 4 golden) |
| Triangulation | (a) two independent PG clients converge on exactly one owner; (b) stale lease reclaim rejects prior owner's completion; (c) changed `request_fingerprint` returns `conflict`; (d) golden test replays the persisted non-zero `movementCount` after a >500 ms render wait |
| Safety net | `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-comprobante.table.test.ts src/modules/socios/forms/ctacte-comprobante.template.test.ts` — exit 0, **15/15** |

### R2.2 — Migration 0033 + schema widening

| Field | Value |
|---|---|
| Pre-change commit | `df1ae2c` (R2a lease docs only — `0033_ctacte_comprobante_retries.sql` not yet present) |
| RED command | MISSING — schema test `ctacte-comprobante-retries.integration.test.ts` was added alongside migration 0033 in `28aad20 fix(api): persist ctacte retry effects` + `cb81718 fix(ctacte): require durable replay and debit keys` |
| Implementation commit | `packages/db/drizzle/0033_ctacte_comprobante_retries.sql` (file present on branch tip; carries `IF NOT EXISTS` columns, `ADD COLUMN IF NOT EXISTS idempotency_operator_id` on `tesoreria.ctacte`, status CHECK, and `ctacte_comprobante_retries_expires_at_idx`); schema widening in `packages/db/src/schema/tesoreria.ts` (`14b769c`, `b403e7c`) |
| GREEN command | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:55433/athlos pnpm --filter @athlos/db test:run src/ctacte-comprobante-retries.integration.test.ts` — exit 0, **2/2** (idempotent re-apply succeeds; CHECK constraint + expiry index present) |
| Triangulation | (a) `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` returns `rowCount === 0` against the unique index shape (`pnpm --filter @athlos/db test:run src/idempotency-index.integration.test.ts` — exit 0, **1/1**); (b) debit-key unique constraint rejects a duplicate owner (`ctacte-comprobante-retries.integration.test.ts` test 2) |
| Safety net | `pnpm --filter @athlos/db typecheck` — exit 0 |

### R2.3 — Debit caller-key path (route + service + client + form)

| Field | Value |
|---|---|
| Pre-change commit | `a597127 fix(ci): repair ctacte checks` (last commit before R2 batch) |
| RED command | MISSING — the `Idempotency-Key` shape tests were added in the same commit as the implementation (`cb81718 fix(ctacte): require durable replay and debit keys`) so a separate RED commit does not exist |
| Implementation commit | `cb81718` (initial key shape), `088a56e` (replay/identity enforcement + PG-backed lease), `67642ed test(ctacte): cover postgres debit owner` (PG owner-identity coverage), `9f000fb fix(ctacte): isolate payment idempotency retries` (operator-id isolation across operators) |
| GREEN command | `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-mutations.registerDebit.test.ts src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts src/routes/ctacte-mutations.test.ts` — exit 0, **52/52** (5 debit + 10 payment + 37 route) |
| Triangulation | (a) identical `Idempotency-Key` + identical canonical `{ operatorId, socioId, monto(2dp), fecha, motivo }` replays the row; (b) identical key + changed canonical payload returns `409 CONFLICT`; (c) distinct keys with identical canonical payload create distinct debits; (d) cross-operator retry rejected (registerPayment test grew from 9 → 10 in `9f000fb`) |
| Safety net | `pnpm --filter @athlos/api typecheck` — exit 0 |

### R2.4 — Migration/runbook documentation

| Field | Value |
|---|---|
| Pre-change state | `docs/runbook.md` only referenced the 0030-era manual deployment pattern |
| RED command | N/A — documentation task; no test artefact |
| Implementation commit | `docs/runbook.md` rewritten to add the `Manual CTACTE comprobante replay migration (0031 → 0032 → 0033)` block, plus `Containerized Deploy → Manual 0033 comprobante replay rollout` block carrying the exact `docker exec -i athlos-db-1 psql -v ON_ERROR_STOP=1 --single-transaction -U athlos -d athlos < <file>` sequence + `SELECT column_name FROM information_schema.columns …` verification query |
| GREEN command | `grep -nc 'ON_ERROR_STOP=1' docs/runbook.md` returns `4` (three migration steps + the snippet one) — captured but not rerun here; the runbook block was shipped in `cb81718` and `088a56e` |
| Triangulation | Three independent blocks recite the same migration order: `Deploy Checklist → Manual CTACTE comprobante replay migration (0031 → 0032 → 0033)`, `Containerized Deploy → Manual 0033 comprobante replay rollout`, and the inline PR deployment note in the PR #31 body |
| Safety net | Documentation-only change; no live behaviour to regress |

## Final targeted validation (disposable PostgreSQL on port 55433)

- `pnpm --filter @athlos/db typecheck` — exit 0.
- `pnpm --filter @athlos/api typecheck` — exit 0.
- `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:55433/athlos pnpm --filter @athlos/db test:run src/ctacte-comprobante-retries.integration.test.ts src/idempotency-index.integration.test.ts` — exit 0, **3/3**.
- `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:55433/athlos pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts src/modules/socios/forms/ctacte-comprobante.lease.test.ts src/modules/socios/forms/ctacte-comprobante.golden.test.ts src/modules/socios/forms/ctacte-comprobante.table.test.ts src/modules/socios/forms/ctacte-comprobante.template.test.ts` — exit 0, **26/26**.
- `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-mutations.registerDebit.test.ts src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts src/routes/ctacte-mutations.test.ts src/modules/ctacte/repository.test.ts src/modules/ctacte/repository.insert.test.ts` — exit 0, **67/67**.

## Migration/runbook evidence (no production touched)

- Disposable PostgreSQL: `docker run --rm --name athlos-r2b-postgres -e POSTGRES_USER=athlos -e POSTGRES_PASSWORD=athlos -e POSTGRES_DB=athlos -p 55433:5432 postgres:16-alpine` (PostgreSQL 16.14); production database `athlos-db-1` was not modified by this branch — verified via `docker exec athlos-db-1 psql -U athlos -d athlos -c "\d tesoreria.ctacte_comprobante_retries"` → `Did not find any relation "tesoreria.ctacte_comprobante_retries".` (production has not yet received 0031/0032/0033, by runbook design).
- Migration 0031 references a `socios.ctacte_movement_notes` table and assumes the existing `socios.socio_attachments(id)` FK from 0020/0021 — both out of disposable scope. The disposable integration tests cover only the `tesoreria.ctacte_comprobante_retries` shape plus a minimal `tesoreria.ctacte (id uuid)` row, which is sufficient for the durable-lease + owner-identity contracts.
- `docs/runbook.md` deployment note is unchanged in this branch; PR #31 already shipped the manual 0031 → 0032 → 0033 rollout blocks in `cb81718` and `088a56e`. R2b inherits those edits rather than re-recording them.

## Evidence boundary

This file records evidence capturable in the current branch against a fresh disposable PostgreSQL 16 container. Earlier R2 entries (`b2cef4a` → `cb81718` → `9f000fb`) lacked separate RED-only commits because their tests were co-shipped with the production changes; those rows explicitly report `MISSING` per the R2.5 instruction not to fabricate. The earlier apply-progress record (the PR #31 corrective batch covering `b403e7c` and `9f000fb`) remains the source of truth for those final commits; this branch only supplements it with the broader R2.1–R2.4 evidence summary. No production database, migration, deployment, or production container was used by this batch.
