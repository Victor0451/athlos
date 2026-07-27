# Apply Progress: Socios Legacy Identity

## Status

PR1 transactional identity foundation and PR2A Drizzle contracts/export parity are complete. PR2B migration-status work remains isolated for its later slice. No commit or PR was created.

## Cumulative Completed Tasks

1.1–3.2 and 4.1.

## Strict TDD Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1–1.4, 2.1–2.4 | `packages/db/src/schema/socios-identity.test.ts` | PostgreSQL integration | 4 tests passed | Migration missing: 4 tests failed | 4 tests passed | UUID, holder, evidence, reapplication/rollback scenarios | Fixtures retained; tests re-run green |
| 3.1 | `packages/db/src/schema/socios-identity-contract.test.ts` | Unit | N/A (new declarations) | 2 tests failed with undefined barrel contracts after restoring the pre-contract schema | 2 tests passed | Skipped: declarative contracts have one exact shape per requirement | None needed; Prettier check passed |
| 3.2 | `packages/db/src/schema/socios-identity-contract.test.ts` | Unit | N/A (new barrel exports) | Same RED run: five exported table contracts were undefined | 2 tests passed | Skipped: exact structural export contract | None needed; Prettier check passed |

## Commands

- `ATHLOS_TEST_DATABASE_URL=<local CI harness> pnpm --filter @athlos/db exec vitest run src/schema/socios-identity.test.ts` → passed: 1 file, 4 tests.
- `pnpm --filter @athlos/db exec vitest run src/schema/socios-identity-contract.test.ts` → RED: 1 file, 2 failed; GREEN: 1 file, 2 passed.
- `pnpm --filter @athlos/db typecheck` → passed.
- `pnpm --filter @athlos/db exec prettier --check src/schema/socios.ts src/schema/index.ts src/schema/socios-identity-contract.test.ts` → passed.
- `git diff --check` and `git diff --cached --check` → passed.

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | Passed: `pnpm --filter @athlos/db exec vitest run src/schema/socios-identity-contract.test.ts` (1 file, 2 tests). |
| Runtime harness | N/A: PR2A defines compile-time Drizzle contracts only; it adds no route, producer, process, or database-execution boundary. `pnpm --filter @athlos/db typecheck` passed as the consumer-import harness. |
| Rollback boundary | Revert `packages/db/src/schema/socios.ts`, `packages/db/src/schema/index.ts`, and `packages/db/src/schema/socios-identity-contract.test.ts`; this removes only PR2A declarations, barrel exports, and their tests. |

## PR2B Preservation

The dirty `migrate:status` reconstruction was removed from the PR2A working diff and retained untouched in Git stash `socios-legacy-identity PR2B migrate-status reconstruction` for the later PR2B slice.

## PR2A Workload Boundary

- Delivery: forced chained, stacked-to-main.
- Start: PR1 identity migration foundation already merged to main.
- End: Drizzle declarations, schema-barrel exports, and focused contract tests only.
- Follow-up: PR2B owns every `migrate:status` file and behavior.

## Remaining Tasks

- [ ] 4.2 Run the PR2B-focused test, typecheck, and migration-status verification; record its work-unit evidence.
