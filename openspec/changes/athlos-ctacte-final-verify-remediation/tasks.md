# Tasks: Athlos Ctacte Final Verify Remediation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~50 docs / ~140 header+tests / ~80 evidence; ≤400 per slice |
| 400-line budget risk | Low |
| Chained PRs recommended | Yes (3 stacked-to-main slices) |
| Suggested split | PR 1 contracts → PR 2 header → PR 3 DB evidence |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Reconcile active delta specs with implemented behavior | PR 1 | `pnpm --filter api test:ctacte-mutations` | N/A — doc-only, harness = existing targeted API suites | Revert two `spec.md` files; runtime untouched |
| 2 | Premium `/ctacte/[cuenta]` header + focused tests | PR 2 | `pnpm --filter web test ctacte/[cuenta]/page.test.tsx` | `pnpm --filter web dev` against mock titular data on `/ctacte/<cuenta>` | Revert `page.tsx` header section + added test cases |
| 3 | Disposable PostgreSQL DB evidence | PR 3 | `pnpm --filter db test:idempotency-index.integration` (gated on `ATHLOS_TEST_DATABASE_URL`) | Real disposable PostgreSQL 16 only; unset variable blocks suite | Discard `verify-report.md` additions; drop disposable DB |

## Phase 1: Slice 1 — Contract Reconciliation (doc-only)

- [x] 1.1 RED/GREEN gate: run targeted API + web ctacte-mutations suites and confirm durable caller-key replay, 409 conflict, and additive toast already pass; record exact command + pass counts in `apply-progress.md` and PR body. **Done** — `apps/api` runs 20/20 pass across `ctacte-mutations.{registerPayment,registerDebit,getMovements}.test.ts`; `apps/web` runs 22/22 pass across `ctacte-mutations.test.ts` plus the four `*.field-errors.test.tsx` modal suites; durable Idempotency-Key, 409 conflict, additive toast, and direct `uploadAttachment({ category: 'comprobante' })` delegation contracts are GREEN on their existing targeted suites.
- [x] 1.2 Edit `openspec/changes/athlos-ctacte-mutations/specs/ctacte-mutations/spec.md` to replace 10-second audit-key wording with durable caller `Idempotency-Key` contract (1–128 chars). **Done** — added `Idempotency-Key` requirement to `Register Payment Endpoint`, `Add Note to Movement Endpoint`, and rewrote `Idempotency Contracts for Mutations` so all four mutations use caller-provided keys with same-payload replay / changed-payload 409.
- [x] 1.3 Edit same spec to replace internal HTTP attachments-route wording with shared `uploadAttachment({ category: 'comprobante', ... })` delegation. **Done** — `Register Payment Endpoint` now states the route MUST delegate directly to the shared service (no internal HTTP call) and adds `category='comprobante'`; the happy-path scenario asserts the in-process invocation.
- [x] 1.4 Edit same spec to replace "SHALL NOT toast" with additive `notify('error', …)` after inline `applyFieldErrors` rendering. **Done** — `Zod Validation + ApiError Surfacing on All Forms` now has two scenarios that require inline field messages via `applyFieldErrors` AND an additive `notify('error', ...)` toast.
- [x] 1.5 Edit `openspec/changes/athlos-ctacte-mutations/specs/ui-design/spec.md` to keep canonical premium-header contract aligned with focused assertions. **Done** — added a "Focused header elements render with canonical tokens" scenario plus a "Header slice review boundary" 400-line scenario; both lock `rounded-xl shadow-sm p-8` card, circular back control, icon tile, uppercase heading, socio/DNI mono metadata, accessible estado badge, and focused-page-test obligations.
- [x] 1.6 Verify diff; create and request-review on PR 1 to `main` (stacked-to-main). **Done** — PR #41 opened against `main` (mergeable, `type:docs` label, closes approved issue #40); the 400-line budget assumption was originally ~50 docs but reality is that the original `athlos-ctacte-mutations/specs/` files were untracked on `main` so this slice also has to commit their reconciled content (~763 authored lines across both spec files). The actual RECONCILIATION edits are ~91 lines added / ~12 lines removed. Budget overrun documented in `apply-progress.md` and PR body. Auto-merge NOT triggered (the user grants the final review/merge); PR is ready-to-merge.

## Phase 2: Slice 2 — Premium Header (TDD)

- [ ] 2.1 RED: append focused Testing Library assertions in `apps/web/src/app/(authed)/ctacte/[cuenta]/page.test.tsx` for `rounded-xl shadow-sm p-8` card, circular back control, icon tile, uppercase titular heading, socio/DNI mono metadata, accessible estado badge; keep existing test ids.
- [ ] 2.2 RED: confirm new assertions fail against current plain flex header; capture failing output.
- [ ] 2.3 GREEN: replace header block in `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` with canonical token-only card preserving existing mutation actions and test ids.
- [ ] 2.4 GREEN: re-run `pnpm --filter web test ctacte/[cuenta]/page.test.tsx`; all assertions pass.
- [ ] 2.5 REFACTOR: extract repeated header primitives if duplication appears; re-run focused test plus `pnpm --filter web typecheck`.
- [ ] 2.6 Verify diff ≤400 lines; merge PR 2 to `main` (stacked-to-main).

## Phase 3: Slice 3 — Disposable PostgreSQL Evidence

- [ ] 3.1 Provision disposable PostgreSQL 16 locally; export its URL as `ATHLOS_TEST_DATABASE_URL`; abort suite if variable is unset or URL is non-disposable.
- [ ] 3.2 RED/GREEN gate: run `pnpm --filter db migrate` against disposable DB; record command + exit in `openspec/changes/athlos-ctacte-mutations/verify-report.md`.
- [ ] 3.3 Run `pnpm --filter db test:idempotency-index.integration` and `pnpm --filter db test:ctacte-comprobante-retries.integration`; record pass/fail per suite.
- [ ] 3.4 Run `pnpm --filter api test:ctacte-movement-notes.postgres.integration` and `pnpm --filter api test:ctacte-comprobante.postgres.integration`; record pass/fail per suite.
- [ ] 3.5 Append redacted disposable-DB identity (no credentials) and passing commands to `verify-report.md`; dispose DB and unset `ATHLOS_TEST_DATABASE_URL`.
- [ ] 3.6 Verify diff ≤400 lines; merge PR 3 to `main` (stacked-to-main).

## Phase 4: Cleanup

- [ ] 4.1 Re-run `pnpm --filter web typecheck` and full `apps/web/src/app/(authed)/ctacte/[cuenta]/page.test.tsx` after all three slices land.
- [ ] 4.2 Confirm no production access, migration, deploy, push, branch, commit, or PR step leaked into any slice.
