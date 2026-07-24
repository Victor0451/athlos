# Tasks: Athlos Production Login Recovery

## Review Workload Forecast

| Unit | Lines | Risk | Dependency |
|---|---:|---|---|
| A1 recovery/evidence | 300–380 | Medium | independent |
| A2 bootstrap | 220–300 | Medium | A1 contracts |
| B1 readiness | 140–220 | Low | independent |
| B2 proxy/config/docs | 280–390 | Medium | PR2 delivered/rebased |
| Total | 940–1,290 | High | A1 → A2; PR2 → B2 |

Decision needed before apply: Resolved — chained PRs, stacked-to-main, slice A1 only.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Delivery metadata: base `25ee4713900b2dd1f842eef8b8633ce5fe91ae41`; worktree `Athlos-worktrees/production-login-recovery-a1`; PR2 #98 merged. Order: A1 then A2; B1 independent; B2 rebases from merged main. Never absorb, cherry-pick, or stage PR2 changes in recovery candidates.

### Suggested Work Units

| Unit | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| A1 | recovery/evidence (300–380) | `bats scripts/tests/recovery*.bats` | disposable clone rehearsal | recovery SQL/scripts/Bats |
| A2 | bootstrap (220–300) | `pnpm --filter @athlos/db test:run -- bootstrap-admin` | clone + FD secret | bootstrap script/tests |
| B1 | readiness (140–220) | `pnpm --filter @athlos/api test:run -- health` | API + disposable Postgres | health route/tests |
| B2 | proxy/config/docs (280–390) | `pnpm --filter @athlos/web test:run -- route` | Compose invalid login 401 | proxy/config/docs |

## Phase 1: Isolated Delivery Foundation

- [x] 1.1 Revalidated base `25ee471`; use `Athlos-worktrees/production-login-recovery-a1` only; never dirty `c10c8c3`.
- [x] 1.2 Recorded merged PR2 #98; no shared stage/cherry-pick/reset-clean; B2 rebases from merged main.
- [x] 1.3 RED: `scripts/tests/recovery-scope.bats` covers wrong cwd, relative selector, PR2 path, staged, unstaged, and valid empty index.
- [x] 1.4 GREEN/REFACTOR: implement `scripts/recovery/check-scope.sh` canonical-root/scope checks; run `bats scripts/tests/recovery-scope.bats`.

## Phase 2: A1 Recovery and Evidence

- [x] 2.1 RED: `recovery-gates.bats` covers unsafe identity/history, checksum drift, missing relation, count/hash mismatch, audit decrease, hostile args, and redaction aborts.
- [x] 2.2 GREEN: create `scripts/recovery/{preflight,rehearse}.sh`, `evidence.schema.json`, and `packages/db/recovery/0001_auth_scheduler.sql`: read-only, clone-only, idempotent, receipt/rollback.
- [x] 2.3 REFACTOR: add disposable PostgreSQL 16 clone harness; rehearse twice and evidence relation/count/hash/audit preservation.

## Phase 3: A2 Controlled Bootstrap

- [ ] 3.1 RED: `bootstrap-admin.test.ts` covers recoverable operator, missing approval/audit, retry, one ADMIN/audit, and no argv/env/evidence secret.
- [ ] 3.2 GREEN/REFACTOR: implement `bootstrap-admin.ts`/package command: FD-only secret, in-memory hash, advisory lock, redacted result; run focused DB test.

## Phase 4: B1 Readiness

- [ ] 4.1 RED: `health.test.ts` covers 2s timeout, every missing relation, redaction, 503 readiness, and dependency-free 200 liveness.
- [ ] 4.2 GREEN/REFACTOR: update `health.ts` with bounded `to_regclass` and `db/schema: ok|down`; run focused API test.

## Phase 5: B2 Proxy, Deployment, and Evidence

- [ ] 5.1 After PR2, rebase on reviewed main; reject a polluted candidate with `check-scope.sh`.
- [ ] 5.2 RED: `route.test.ts` covers missing/invalid URL, credential redaction, upstream 401, and bounded 502.
- [ ] 5.3 GREEN/REFACTOR: update proxy, `Dockerfile.web`, Compose, deploy workflow, `.env.example`, and runbook for explicit URL/readiness/rollback; run web test and Compose scenario.

## Phase 6: Deferred Operator Execution

- [ ] 6.1 Block migration, bootstrap, deploy, restart, secret mutation, and production DB writes pending explicit approval, window, verified clone evidence, and abort decision.
