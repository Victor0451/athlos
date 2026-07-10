# Apply Progress — athlos-ctacte-mutations R2b evidence correction

**Mode**: Strict TDD evidence reconciliation (documentation-only correction)
**Branch**: `fix/ctacte-mutations-r2b`
**Base**: `origin/main` after PR #31 merge (`b400f99`)
**Scope**: Correct the PR #32 R2b evidence/documentation incident in `apply-progress.md` and, where necessary, `tasks.md`. This correction does not modify application code, migrations, workflows, production data, deployments, or containers; it only updates the existing PR branch with documentation changes.

## Evidence correction boundary

- PR #32 is an evidence/documentation branch. Before this correction, the PR head commit was `2ff26dc docs(sdd): close R2.5 strict-TDD evidence and capture disposable-PostgreSQL replay runs`, touching only `openspec/changes/athlos-ctacte-mutations/apply-progress.md` and `openspec/changes/athlos-ctacte-mutations/tasks.md` relative to `origin/main`.
- Untracked OpenSpec artifacts (`proposal.md`, `design.md`, `exploration.md`, `specs/`, `verify-report.md`, and `openspec/changes/athlos-ctacte-canonical-pattern/`) predate this incident and are not part of this correction.
- A read-only production schema inspection did occur before this correction: `docker exec athlos-db-1 psql -U athlos -d athlos -c "\d tesoreria.ctacte_comprobante_retries"` returned `Did not find any relation "tesoreria.ctacte_comprobante_retries".` That is production database/container read access. It was not DDL, DML, migration execution, deployment, or container mutation.
- This file records that read-only production access accurately. The accurate boundary is: no production DDL/DML, no production migration, no deployment, and no container mutation are recorded for R2b.

## Evidence rules applied here

- Impossible chronology was removed. In particular, `df1ae2c` is not a valid pre-change commit for R2.1 or R2.2 because it descends from the implementation commits cited for those rows.
- Unsupported RED evidence is recorded as `MISSING`; no RED command or failure text is invented.
- Unsupported aggregate test totals are recorded as `MISSING`; no test count is retained unless it is backed by an exact command/result in this correction or a cited current CI artifact.
- R2.4 has exact implementation commits and a reproducible documentation command/result. R2.1–R2.3 still lack full strict-TDD evidence in this artifact.

## TDD Cycle Evidence (R2.1 – R2.4)

### R2.1 — Comprobante replay (golden helper + durable lease state machine)

| Field | Value |
|---|---|
| Pre-change commit | MISSING — the prior `df1ae2c` claim was invalid. `14b769c` is an ancestor of `df1ae2c`, so `df1ae2c` cannot prove a pre-change state for `14b769c`. |
| RED command | MISSING — no exact RED command, exit code, and failing assertion is available in this branch. |
| Implementation commit(s) | Cited path history shows `14b769c fix(ctacte): enforce durable comprobante leases`, `088a56e fix(ctacte): enforce replay request identity`, and `b403e7c fix(ctacte): guard replay reclaim identity` modified comprobante replay paths; this row does not claim a complete strict-TDD cycle without RED/GREEN evidence. |
| GREEN command/result | MISSING — the previous targeted totals are not retained because this correction did not rerun those commands and no current CI artifact is cited here with those exact targeted counts. |
| Triangulation | MISSING — behavior intent may exist in tests/code history, but this artifact cannot prove the strict-TDD triangulation cases with exact runs. |
| Safety net | MISSING. |
| Status decision | Evidence incomplete for R2.5 purposes. |

### R2.2 — Migration 0033 + schema widening

| Field | Value |
|---|---|
| Pre-change commit | MISSING — the prior `df1ae2c` claim was invalid. `28aad20 fix(api): persist ctacte retry effects` added `packages/db/drizzle/0033_ctacte_comprobante_retries.sql`, and `28aad20` is an ancestor of `df1ae2c`; therefore `df1ae2c` already contains migration 0033. |
| RED command | MISSING — no exact RED command, exit code, and failing assertion is available in this branch. |
| Implementation commit(s) | `28aad20 fix(api): persist ctacte retry effects` added `packages/db/drizzle/0033_ctacte_comprobante_retries.sql`; later migration/schema edits appear in `cb81718 fix(ctacte): require durable replay and debit keys`, `14b769c fix(ctacte): enforce durable comprobante leases`, `088a56e fix(ctacte): enforce replay request identity`, and `67642ed test(ctacte): cover postgres debit owner`. |
| GREEN command/result | MISSING — the previous targeted totals are not retained because this correction did not rerun those commands and no current CI artifact is cited here with those exact targeted counts. |
| Triangulation | MISSING. |
| Safety net | MISSING. |
| Status decision | Evidence incomplete for R2.5 purposes. |

### R2.3 — Debit caller-key path (route + service + client + form)

| Field | Value |
|---|---|
| Pre-change commit | MISSING for strict-TDD proof — `a597127 fix(ci): repair ctacte checks` may be before the R2 corrective commits, but this artifact does not have an exact RED run from that state. |
| RED command | MISSING — no exact RED command, exit code, and failing assertion is available in this branch. |
| Implementation commit(s) | Cited path history includes `cb81718 fix(ctacte): require durable replay and debit keys`, `088a56e fix(ctacte): enforce replay request identity`, `67642ed test(ctacte): cover postgres debit owner`, and `9f000fb fix(ctacte): isolate payment idempotency retries`. |
| GREEN command/result | MISSING — the previous targeted totals are removed because this correction did not rerun those commands and no current CI artifact is cited here with those exact targeted counts. |
| Triangulation | MISSING — same-key replay, changed-payload conflict, distinct-key insertion, and cross-operator rejection are not re-claimed here without exact command evidence. |
| Safety net | MISSING. |
| Status decision | Evidence incomplete for R2.5 purposes. |

### R2.4 — Migration/runbook documentation

| Field | Value |
|---|---|
| Pre-change state | `docs/runbook.md` had no R2 durable-comprobante manual 0031→0032→0033 rollout blocks before the cited implementation commits. |
| RED command | MISSING — documentation task; no exact RED command, exit code, and failing assertion is available in this branch. |
| Implementation commit(s) | `cb81718 fix(ctacte): require durable replay and debit keys` added `docs/runbook.md` lines 5–15 (`Manual CTACTE comprobante replay migration (0031 → 0032 → 0033)`). `088a56e fix(ctacte): enforce replay request identity` added `docs/runbook.md` lines 277–288 (`Manual 0033 comprobante replay rollout`) with the exact `docker exec -i athlos-db-1 psql -v ON_ERROR_STOP=1 --single-transaction ...` sequence and verification query. |
| GREEN/documentation command | `grep -nc 'ON_ERROR_STOP=1' docs/runbook.md` |
| Exit code | `0` |
| Count/result | `5` matching lines. |
| Triangulation | The runbook contains the deploy-checklist summary and the detailed manual 0033 rollout command block; this row does not claim PR-body evidence beyond the repository file. |
| Safety net | Documentation-only; no runtime safety net is claimed. |
| Status decision | R2.4 documentation evidence is supported for the cited command/count, but it does not close R2.5 because R2.1–R2.3 evidence remains incomplete. |

## Removed unsupported validation claims

The prior artifact claimed targeted pass totals for R2.1–R2.3 and final validation. Those totals are not recorded as facts here because this correction did not rerun those targeted commands and no current CI artifact is cited here with those exact command-specific pass counts. Their status for R2.5 is `MISSING`.

## Production schema inspection record

The previously recorded production command was a read-only schema inspection:

```bash
docker exec athlos-db-1 psql -U athlos -d athlos -c "\d tesoreria.ctacte_comprobante_retries"
```

Recorded result:

```text
Did not find any relation "tesoreria.ctacte_comprobante_retries".
```

This means R2b did access the production database/container read-only for schema inspection. It does not prove any DDL, DML, migration, deployment, or container mutation. This correction did not run production commands.

## R2.5 status

R2.5 remains incomplete. This correction makes the evidence artifact truthful by marking unavailable strict-TDD evidence as `MISSING`, removing unsupported pass totals, and recording the production read-only schema inspection accurately. It does not close the overall SDD verification because full strict-TDD RED/GREEN evidence for R2.1–R2.3 is still not provable from this branch.
