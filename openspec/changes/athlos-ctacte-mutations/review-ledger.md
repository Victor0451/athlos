# Review Ledger — athlos-ctacte-mutations

**Target**: PR #28 (`main...feat/ctacte-mutations-a2`)  
**Review tier**: Full 4R (`+2646/-9`, 15 files) + post-apply Judgment Day  
**Date**: 2026-07-09  
**Verdict**: BLOCKED — fixes required before merge  
**Judgment Day**: APPROVED after Fix Round 2

## Findings

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| R3-001 | reliability | `apps/web/src/components/ctacte/CtacteComprobanteButton.tsx:89-93` | BLOCKER | verified | Web typecheck and production build were restored by removing unsupported modal props and correcting form typing. |
| R3-006 | reliability | `.github/workflows/test.yml:46` | BLOCKER | verified | Root test execution now delegates to package-specific configurations. |
| R4-003 | resilience | `.github/workflows/test.yml:148-149` | BLOCKER | verified | Docker `node --version` smoke now passes without bypassing the image's normal `tsx` production startup path. |
| R3-002 | reliability | `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx:87-95` | CRITICAL | verified | A matching GET notes route/client wrapper and explicit query error state were added. |
| R4-005 | resilience | `apps/web/src/lib/api/ctacte-mutations.ts:86-92` | CRITICAL | verified | Multipart parsing now accepts field-only payment requests and keeps the attachment optional. |
| R4-006 | resilience | `apps/web/src/components/ctacte/CtactePaymentForm.tsx:70-86` | CRITICAL | verified | Payment retries now replay only an identical canonical payment and return an explicit conflict for changed account or payload. |
| R2-002 | readability | `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx:244-250` | CRITICAL | verified | The notes component is keyed by movement ID, resetting draft/edit state on selection changes. |
| R3-003 | reliability | `apps/web/src/components/ctacte/CtacteNotesSection.tsx:149-160` | CRITICAL | verified | Misleading no-op edit/delete controls were removed. |
| R3-004 | reliability | `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx:236-251` | WARNING | info | The row Nota action mounts a collapsed section; the implemented `CtacteNoteForm` modal has no production caller. |
| R3-005 | reliability | `apps/web/src/components/ctacte/CtacteNotesSection.tsx:49-64` | WARNING | info | Collapse persistence is keyed by movement ID rather than cuenta ID. |
| R4-008 | resilience | `apps/web/src/components/ctacte/CtacteComprobanteButton.tsx:64-69` | WARNING | info | PDF and payment-preview object URLs are not revoked, retaining blobs until page unload. |
| JD-A-009 | judgment-day | `apps/web/src/components/ctacte/CtactePaymentForm.tsx:28-31` | WARNING | info | Amount schemas allow more than two decimal places; backend formatting can silently round financial input. Assessment: real. |
| JD-B-006 | judgment-day | `apps/web/src/components/ctacte/CtacteComprobanteButton.tsx:70-71` | WARNING | info | API failures are reduced to a generic toast; cap-50 and field-level errors cannot render inline. Assessment: real. |
| R4-007 | resilience | `apps/web/src/components/ctacte/CtactePaymentForm.tsx:84-86` | BLOCKER | refuted | All three refuters agreed that missing telemetry is an observability gap, not a merge-blocking defect; failures are surfaced to the operator via toast. |
| R4-F001 | resilience | `apps/api/src/modules/ctacte/repository.ts:192-196` | BLOCKER | verified | Forward-only migration 0032 replaces the partial index with a full unique index, so `ON CONFLICT (idempotency_key)` is inferable by PostgreSQL. |
| R2-F001 | readability | `apps/api/src/routes/ctacte-mutations.ts:299-303` | CRITICAL | verified | GET notes now resolves the movement using both movement ID and socio ID, rejecting cross-socio requests with 404. |
| R3-F001 | reliability | `apps/api/src/modules/socios/forms/ctacte-mutations.ts:147-173` | CRITICAL | verified | A reused key compares socio, amount, date, concept, and attachment SHA-256 before replaying; mismatches return `CONFLICT`/409. |
| R4-F002 | resilience | `docker-entrypoint.sh:15-20` | BLOCKER | refuted | Two of three refuters confirmed normal production startup uses `tsx`, not `node`; the bypass does not skip its readiness/migration path. |
| R3-2001 | reliability | `apps/web/src/components/ctacte/CtactePaymentForm.tsx:69-98` | BLOCKER | refuted | Two of three refuters found that missing dedicated lifecycle coverage does not demonstrate a current defect; the implementation preserves and rotates the key correctly. |
| R3-2002 | reliability | `packages/db/src/idempotency-index.integration.test.ts:19-32` | BLOCKER | verified | Ran against an isolated PostgreSQL 16 container with `ATHLOS_TEST_DATABASE_URL`; the assertion executed and confirmed `ON CONFLICT (idempotency_key)` succeeds with the full unique index. |

## Review Evidence

- Security/risk lens: empty ledger.
- Targeted web tests: 61/61 passed under the app-specific Vitest configuration.
- Required web typecheck/build: failed on PR-introduced code.
- GitHub required checks: `test` and `Docker build smoke` failed.
- Judgment Day convergence: both blind judges independently confirmed the build failure, notes GET mismatch, optional-file payment failure, and no-op note mutations.
- Refutation: correctness, impact, and reproducibility refuters evaluated the complete 4R BLOCKER/CRITICAL list; only R4-007 was refuted by 3/3.

## Next Action

Apply one scoped fix round for all open BLOCKER/CRITICAL findings, then re-review only the fix diff against this ledger.

## Fix Round 1 Evidence

- `pnpm --filter @athlos/web typecheck` — passed.
- `pnpm --filter @athlos/api typecheck` — passed.
- `pnpm --filter @athlos/web build` — passed.
- `pnpm --filter @athlos/api exec vitest run src/routes/ctacte-mutations.test.ts` — passed (20 tests).
- `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts` — passed (4 tests).
- `pnpm --filter @athlos/web exec vitest run src/lib/api/ctacte-mutations.test.ts` — passed (9 tests).
- `pnpm --filter @athlos/web exec vitest run src/components/ctacte/CtactePaymentForm.test.tsx` — passed (8 tests).
- `pnpm --filter @athlos/web exec vitest run src/components/ctacte/CtacteNotesSection.test.tsx` — passed (8 tests).
- `pnpm --filter @athlos/web exec vitest run 'src/app/(authed)/ctacte/[cuenta]/page.test.tsx'` — passed (16 tests).
- `pnpm --filter @athlos/web exec vitest run src/components/ctacte/CtacteComprobanteButton.test.tsx` — passed (7 tests).
- `pnpm --filter @athlos/web exec vitest run src/components/ctacte/CtacteDebitForm.test.tsx` — passed (7 tests).
- `docker build -t athlos-api:round1-smoke . && docker run --rm athlos-api:round1-smoke node --version` — passed (`v22.23.1`).

## Fix Round 1 Re-review

- Verified: R3-001, R3-006, R4-003, R3-002, R4-005, R2-002, R3-003.
- Still open: R4-006.
- New confirmed findings: R4-F001, R2-F001, R3-F001.
- Refuted after 2-of-3 vote: R4-F002.
- Judgment Day judges disagreed on R4-006; the three full-4R refuters independently confirmed its underlying PostgreSQL and payload-mismatch defects.
- Next action: final Fix Round 2, followed by scoped re-review. No further fix round is allowed after Round 2.

## Fix Round 2 Evidence

- `pnpm --filter @athlos/api exec vitest run src/modules/ctacte/repository.insert.test.ts` — passed (8 tests).
- `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts` — passed (9 tests; identical retry plus amount, date, concept, and attachment mismatch rejection).
- `pnpm --filter @athlos/api exec vitest run src/routes/ctacte-mutations.test.ts` — passed (22 tests; changed-payload/socio 409 and cross-socio notes 404).
- `pnpm --filter @athlos/db exec vitest run src/idempotency-index.integration.test.ts` — passed (1 test; uses a real PostgreSQL `Pool` when `ATHLOS_TEST_DATABASE_URL` is explicitly supplied; no database URL was supplied in this run).
- `pnpm --filter @athlos/api typecheck` — passed.
- `pnpm --filter @athlos/db typecheck` — passed.

## Fix Round 2 Re-review

- Both Judgment Day judges approved R4-006, R4-F001, R2-F001, and R3-F001.
- Full-4R scoped review also verified those four code fixes.
- R3-2001 was refuted by 2-of-3 vote.
- R3-2002 was subsequently verified against an isolated PostgreSQL 16 container with `ATHLOS_TEST_DATABASE_URL`; the assertion executed and passed.
- Convergence budget is exhausted after two fix rounds; no further automatic fix round is permitted.
- Overall PR review is APPROVED; all BLOCKER and CRITICAL findings are verified or refuted.
