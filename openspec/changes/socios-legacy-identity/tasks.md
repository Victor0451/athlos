# Tasks: Socios Legacy Identity Foundation

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 460–560 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Transactional additive identity DDL and invariant suite | PR 1 | `ATHLOS_TEST_DATABASE_URL=… pnpm --filter @athlos/db test:run -- socios-identity.test.ts` | Disposable PostgreSQL schema: migration twice, parallel allocation and holder writes | `0037` plus its test; forward-fix drops/disables only new objects after proving no consumers |
| 2 | Drizzle contracts and export parity | PR 2 | `pnpm --filter @athlos/db typecheck` | N/A: no routes or producer; compile-time schema import | `socios.ts` identity declarations and `index.ts` exports only |

## Phase 1: RED Integration Tests

- [x] 1.1 Create failing `packages/db/src/schema/socios-identity.test.ts` tests for S1/S2: UUIDs, independent generated numbers, and parallel collision-safe allocation.
- [x] 1.2 Add failing S3/S4 PostgreSQL tests: transfer closes/opens history, concurrent current holders and overlapping ranges fail without changing history.
- [x] 1.3 Add failing S5/S6 tests: raw-event retry is idempotent; duplicate, ambiguous, or incomplete SOCCARNET/SOCFAMILIA evidence remains separate and `review_required`.
- [x] 1.4 Add failing S7/S8 tests: re-applying the migration preserves Socio/CTACTE FKs; invalid aggregate writes roll back every new row and audit row.

## Phase 2: GREEN Transactional Migration

- [x] 2.1 Create `packages/db/drizzle/0037_socios_legacy_identity.sql` with `BEGIN/COMMIT`, additive account, member, membership, holder-history, and evidence objects, independent sequences, FKs, and indexes.
- [x] 2.2 Implement deferred holder/overlap constraints, composite membership ownership, raw-event uniqueness, non-unique legacy-pair indexing, and non-sensitive migration diagnostics to satisfy S1–S6.
- [x] 2.3 Make guarded DDL re-applicable; document its forward-fix-only rollback precondition in the migration header, without touching legacy tables or consumers.
- [x] 2.4 Run the focused PostgreSQL suite and make every S1–S8 RED test pass; keep logs limited to counts and error codes.

## Phase 3: GREEN Drizzle Contracts

- [ ] 3.1 Modify `packages/db/src/schema/socios.ts` with matching identity enums, five table declarations, indexes, opaque nullable `credentialRef`, and inferred types; do not alter `socios`.
- [ ] 3.2 Modify `packages/db/src/schema/index.ts` to export only the new additive contracts; typecheck consumers to confirm Socio/CTACTE compatibility.

## Phase 4: REFACTOR and Verification

- [x] 4.1 Refactor `socios-identity.test.ts` fixtures/helpers without weakening concurrency, deferred-constraint, idempotency, privacy, or rollback assertions.
- [ ] 4.2 Run focused test, `pnpm --filter @athlos/db typecheck`, and migration status; record PR 1/PR 2 work-unit commits with their tests in the same commit.
