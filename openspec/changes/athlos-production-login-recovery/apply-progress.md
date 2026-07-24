# Apply Progress: A1 Recovery and Evidence

## Status

Tasks 1.1–2.3 are complete. The first disposable PostgreSQL 16 rehearsal exposed an ordering defect; an explicitly authorized bounded correction then passed.

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.3–1.4 | `bats scripts/tests/recovery-scope.bats scripts/tests/recovery-gates.bats` exited 1 before scripts existed | Same command exited 0; 10/10 passed | Clean |
| 2.1–2.2 | Same RED command exited 1 before scripts existed | Same command exited 0; 10/10 passed | Clean |
| 2.3 | Stateful Bats case exited 1 (4 passed, 1 failed) when recovery outputs were validated before SQL application | `bats scripts/tests/recovery-gates.bats` exited 0 (5/5); PostgreSQL 16 rehearsal exited 0 with `runs=2`, `audit_events=1` | Gate order now requires only `audit_events` before recovery and validates all four relations afterward |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | `bats scripts/tests/recovery-scope.bats scripts/tests/recovery-gates.bats` — exit 0, 10/10. |
| Static checks | `shellcheck scripts/recovery/*.sh scripts/tests/recovery-scope.bats scripts/tests/recovery-gates.bats && git diff --check` — exit 0. |
| Runtime harness | `./scripts/recovery/rehearse-postgres16.sh` — exit 0; checksum `4f35d9a93b4b35e4c0be4ae09b93fed4586d0a5e8642b1fa2e5ffd3cf0986638`; `runs=2`; `audit_events=1`. |
| Delivery verification | PostgreSQL initialization waits for the final startup marker plus `pg_isready`; rehearsal, Bats 10/10, ShellCheck, and `git diff --check` exited 0. |
| Security correction | Database-resident clone nonce is verified before mutation; partial relation structures fail closed. PostgreSQL rehearsal, Bats 14/14, ShellCheck, and diff check exited 0. |
| Rollback boundary | `scripts/recovery/`, `scripts/tests/recovery-*.bats`, `packages/db/recovery/0001_auth_scheduler.sql`. |

No production, SSH, Tailnet, deploy, restart, secret, or production-database operation occurred.
