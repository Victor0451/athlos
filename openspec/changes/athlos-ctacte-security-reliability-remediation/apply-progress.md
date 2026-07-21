# Apply Progress: athlos-ctacte-security-reliability-remediation

## Status Consumed

- Workspace root: `/home/vlongo/work/athlos-worktrees/athlos-s2d-add-note`
- Branch: `fix/ctacte-atomic-add-note`
- Base: `origin/main` at `6764194`
- Active slice: S2.d only — Atomic addNote
- Artifact store: OpenSpec files under `openspec/changes/athlos-ctacte-security-reliability-remediation/`
- Strict TDD: active (Vitest / pnpm)
- Workload boundary: chained PR slice, `stacked-to-main`; do not implement S2.e, S3, or S4.
- Action-context warning honored: original workspace is on an old docs branch; only the clean worktree above was edited.

## Completed Tasks

- [x] 3.1 RED-GREEN apps/api/src/modules/socios/ctacte_movement_notes.ts -- wrap insertNote + emitNoteAddedAudit in db.transaction(...); widen emitNoteAddedAudit to (dbOrTx, ..., { callerKey }); drop best-effort try/catch.
- [x] 3.2 EXTEND two test files (mock db transaction wrapper + wrapPool proxies pool.connect(), ~53 line fixture).

Persisted task checkbox updates were applied in `openspec/changes/athlos-ctacte-security-reliability-remediation/tasks.md` and re-read after update.

## Files Changed

- `apps/api/src/modules/socios/ctacte_movement_notes.ts`
- `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts`
- `apps/api/src/modules/socios/ctacte_movement_notes.test.ts`
- `apps/api/src/modules/socios/ctacte_movement_notes_repository.concurrent.test.ts`
- `apps/api/src/modules/socios/ctacte_movement_notes.full-forward-sequence.integration.test.ts`
- `openspec/changes/athlos-ctacte-security-reliability-remediation/tasks.md`

## TDD Cycle Evidence

| Task | Test File                                                                                                                                                 | Layer                         | Safety Net                                                             | RED                                                                                                                                                                                           | GREEN                                                                                    | TRIANGULATE                                                                                                         | REFACTOR                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 3.1  | `apps/api/src/modules/socios/ctacte_movement_notes.test.ts`                                                                                               | Unit/service                  | Blocked: `vitest` unavailable (`spawn ENOENT`, `node_modules` missing) | Added failing behavioral tests for transaction handle, callerKey propagation, and audit-failure propagation before production edits; RED execution blocked by missing local test dependencies | Production changed minimally; GREEN execution blocked by missing local test dependencies | Added separate success + failure cases; failure case proves no best-effort swallow                                  | Removed best-effort try/catch and stale comments         |
| 3.2  | `ctacte_movement_notes.test.ts`, `ctacte_movement_notes_repository.concurrent.test.ts`, `ctacte_movement_notes.full-forward-sequence.integration.test.ts` | Unit + PG integration fixture | Blocked: `vitest` unavailable (`spawn ENOENT`, `node_modules` missing) | Extended mock db with `transaction`; extended pool wrappers so transaction clients returned from `connect()` are proxied                                                                      | GREEN execution blocked by missing local test dependencies                               | Existing concurrent/integration tests exercise wrapped pool clients; unit test asserts tx object reaches repo/audit | Fixture helpers normalized around query/connect wrapping |

## Test Commands Run

1. Safety net / RED attempt:
   - `pnpm --filter @athlos/api test:run -- ctacte_movement_notes.test.ts`
   - Result: failed before tests ran: `sh: 1: vitest: not found`; pnpm warned `node_modules` missing.
2. Focused GREEN attempt:
   - `pnpm --filter @athlos/api test:run -- ctacte_movement_notes.test.ts ctacte_movement_notes_repository.concurrent.test.ts ctacte_movement_notes.full-forward-sequence.integration.test.ts`
   - Result: failed before tests ran: `sh: 1: vitest: not found`; pnpm warned `node_modules` missing.
3. Static diff hygiene:
   - `git diff --check`
   - Result: passed (no whitespace errors).

## Deviations from Design

- None in implementation shape: `addNote` now uses a single `db.transaction(...)` around note insert and audit emission, propagates audit errors, and sends caller key into the audit record.
- Verification is incomplete because the clean worktree has no installed `node_modules` / `vitest` binary.

## Verification Update

Parent resumed after the original apply task was cancelled and installed workspace dependencies with `pnpm install --frozen-lockfile` in the clean worktree; the lockfile remained unchanged.

- `git diff --check` — passed.
- `pnpm --filter @athlos/api exec vitest run src/modules/socios/ctacte_movement_notes.test.ts` — passed (17 tests).
- `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/ctacte_movement_notes_repository.concurrent.test.ts src/modules/socios/ctacte_movement_notes.full-forward-sequence.integration.test.ts` — passed (14 tests).
- `pnpm --filter @athlos/api typecheck` — initially failed on the recursive mock db initializer type in `ctacte_movement_notes.test.ts`; fixed with an explicit mock db return shape; rerun passed.

## Remaining Tasks

- [ ] 3.3 COMMIT + PR `S2.d: atomic addNote`; base = PR 7.
- Parent-owned lifecycle actions remain deferred: bounded review, commit, push, PR, and native receipt gates.

## Workload / PR Boundary

- Slice implemented: S2.d only.
- Approximate diff size: 266 changed lines (`git diff --stat`: 164 insertions, 102 deletions), under the 400-line review budget.
- Rollback boundary: revert the six files listed above; no S2.e/S3/S4 files were intentionally changed.

---

## S2.e Apply Update — Atomic registerDebit

### Status Consumed

- Workspace root / sole allowed edit root: `/home/vlongo/work/athlos-worktrees/athlos-s2e-register-debit`
- Branch: `fix/ctacte-atomic-register-debit`
- Base: `origin/main` at `06069debdc3fb2421460d2d6886c8b550a4c18b3`
- Active slice: S2.e only — atomic `registerDebit`
- Artifact store: OpenSpec
- Strict TDD: active; global strict-TDD guidance loaded
- Delivery boundary: one `stacked-to-main` S2.e work unit under 400 changed lines
- Action context honored: only the authorized clean S2.e worktree was edited; no review, staging, commit, push, issue, or PR command was run.

### Completed Tasks and Persisted Checkboxes

- [x] 4.1 RED focused registerDebit unit tests -- require one transaction handle for ledger + audit, callerKey propagation, propagated audit failure, and no attachment compensation.
- [x] 4.2 GREEN `apps/api/src/modules/socios/forms/ctacte-mutations.ts` -- wrap debit insert + `CTACTE_DEBIT_REGISTERED` audit in `db.transaction`; pass `tx` and caller key; remove best-effort audit swallowing.
- [x] 4.3 TRIANGULATE disposable PostgreSQL atomic tests -- prove happy debit + audit commit and forced-audit-failure rollback of both, with no debit attachment compensation.
- [x] 4.4 REFACTOR local atomic-audit documentation; no S3, S4, emitter cleanup, or unrelated implementation.
- [x] 4.5 VERIFY focused unit + PostgreSQL atomic suites, API typecheck, and diff hygiene; parent owns review/commit/push/PR lifecycle.

These exact rows were added to and checked in the persisted `tasks.md` artifact.

### Files Changed

- `apps/api/src/modules/socios/forms/ctacte-mutations.ts`
- `apps/api/src/modules/socios/forms/ctacte-mutations.registerDebit.test.ts`
- `apps/api/src/modules/socios/forms/ctacte-mutations.atomic.test.ts`
- `openspec/changes/athlos-ctacte-security-reliability-remediation/tasks.md`
- `openspec/changes/athlos-ctacte-security-reliability-remediation/apply-progress.md`

### TDD Cycle Evidence

| Task    | Test File                                | Layer                       | Safety Net                                   | RED                                                                                               | GREEN                                                          | TRIANGULATE                                                                                                           | REFACTOR                                                           |
| ------- | ---------------------------------------- | --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 4.1–4.2 | `ctacte-mutations.registerDebit.test.ts` | Mock/unit                   | 5/5 passed before edits                      | Observed 2 failures: transaction was never called and audit failure resolved instead of rejecting | 6/6 passed after transaction + propagated audit implementation | Happy commit path plus audit-failure path use distinct amounts, reasons, and caller keys; replay path remains covered | Removed stale best-effort audit documentation; 6/6 remained green  |
| 4.3     | `ctacte-mutations.atomic.test.ts`        | Real PostgreSQL integration | 2/2 payment atomic tests passed before edits | Observed debit rollback test fail because the promise resolved after swallowed audit failure      | 4/4 payment + debit atomic tests passed                        | Debit happy commit proves ledger+audit rows; forced audit failure proves zero ledger, audit, and attachment rows      | Shared disposable schema/pool harness retained; 4/4 remained green |

### Commands and Results

1. `pnpm install --frozen-lockfile` — passed; 788 packages linked; `pnpm-lock.yaml` hash stayed `0f9364029d1238c8c4ac4c923dbc6f16b8a246be`.
2. Safety net: `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-mutations.registerDebit.test.ts` — passed, 1 file / 5 tests.
3. Safety net: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-mutations.atomic.test.ts` — passed, 1 file / 2 tests.
4. RED unit command (same focused unit command) — failed as expected, 2 failed / 4 passed: no transaction call; swallowed audit failure resolved.
5. RED PostgreSQL command (same focused PostgreSQL command) — failed as expected, 1 failed / 3 passed: forced debit audit failure resolved and debit committed.
6. GREEN/refactor focused unit command — passed, 1 file / 6 tests.
7. GREEN/refactor focused PostgreSQL command — passed, 1 file / 4 tests.
8. `pnpm --filter @athlos/api typecheck` — passed (`tsc --noEmit`).
9. `git diff --check` — passed.

### Deviations from Design

- None. Debit uses no attachment upload and therefore has no compensation path; transaction rollback is sufficient.

### Remaining Tasks

- Active S2.e implementation tasks: none.
- Exact historical unchecked lifecycle row preserved byte-for-byte: `- [ ] 3.3 VERIFY + COMMIT + PR \`S2.d: atomic addNote\`; base = PR 7.`
- Other unchecked S1, S2 emitter-cleanup, S3, and S4 rows in `tasks.md` remain out of scope and unchanged.
- Parent-owned deferred lifecycle actions: bounded review, receipt handling, staging, commit, push, and PR.

### Workload / PR Boundary

- Slice implemented: S2.e only.
- Rollback boundary: revert the five S2.e files listed above; this removes atomic debit behavior, focused proofs, and S2.e progress without touching S2.d history.
- Runtime harness: disposable PostgreSQL at `localhost:5563`, exercised by the focused atomic Vitest command above.

---

## S3.remainder Apply Update — Actor-Bound Replay and Attachment Proof

### Status Consumed

- Workspace root / sole allowed edit root: `/home/vlongo/work/athlos-worktrees/athlos-s3-remainder`
- Branch: `fix/ctacte-actor-bound-replay`
- Base: `origin/main@b368cb12359f6c4600e769511884243378dbe2f5`
- Artifact store: OpenSpec; apply state: ready
- Active slice: corrected S3.remainder only; S3.foundation was already merged in PR #54
- Strict TDD: active; global strict-TDD guidance loaded
- Delivery boundary: one `stacked-to-main` work unit, target 160–300 and hard stop before 400 changed lines
- Action context honored: only the authorized worktree was edited. No schema, migration, S4, pending HTTP 500 follow-up, review lifecycle, staging, commit, push, issue, or PR action was performed.

### Completed Tasks and Persisted Checkboxes

- [x] 4.1 S3.foundation RED: prove failed payment persistence removes the newly uploaded attachment row and file.
- [x] 4.2 S3.foundation GREEN: add the retry-safe `compensateNewAttachment` primitive used by `registerPayment`.
- [x] 4.3 RED actor-bound comprobante replay: actor B replaying actor A's completed key conflicts while actor A can replay it.
- [x] 4.4 GREEN actor-bound comprobante replay: include `operatorId` in the request fingerprint/ownership decision without weakening lease semantics.
- [x] 4.5 PROVE payment attachment provenance through `registerPayment`: payment `comprobanteAttachmentId` links to attachment `socioId`, `uploadedBy`, `category`, and SHA-256; add production code only if the proof exposes a gap.
- [x] 4.6 PROVE prior-attachment preservation through `registerPayment`: replay never compensates or deletes the attachment persisted by a prior successful payment.

The S3 subsection was first reconciled to the approved scope, preserving completed S3.foundation history. All six rows are visibly checked in the persisted `tasks.md` artifact.

### Files Changed

- `apps/api/src/modules/socios/forms/ctacte-comprobante.ts`
- `apps/api/src/modules/socios/forms/ctacte-comprobante.lease.test.ts`
- `apps/api/src/routes/ctacte-mutations.test.ts`
- `apps/api/src/modules/socios/forms/ctacte-mutations.atomic.test.ts`
- `openspec/changes/athlos-ctacte-security-reliability-remediation/tasks.md`
- `openspec/changes/athlos-ctacte-security-reliability-remediation/apply-progress.md`

### TDD Cycle Evidence

| Task    | Test File                                                             | Layer                             | Safety Net       | RED                                                                                                          | GREEN                                                                                   | TRIANGULATE                                                                                                                                                            | REFACTOR                                                                                           |
| ------- | --------------------------------------------------------------------- | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 4.3–4.4 | `ctacte-comprobante.lease.test.ts`, `routes/ctacte-mutations.test.ts` | Service + route integration       | Lease 3/3 passed | Observed 1/4 failure: actor B received actor A's completed PDF instead of a conflict                         | Adding `operatorId` to the canonical fingerprint made 4/4 lease tests pass              | Same actor replay remains 200 without rendering; actor B receives `CONFLICT`, mapped to HTTP 409; existing changed-payload and failed/stale lease cases remain covered | Minimal fingerprint-only production edit; no lease-store or route contract changes                 |
| 4.5–4.6 | `ctacte-mutations.atomic.test.ts`                                     | Disposable PostgreSQL integration | 4/4 passed       | N/A: proof-only tasks; approved scope required production changes only if existing integration exposed a gap | 4/4 passed with joined payment/attachment provenance and replay-preservation assertions | One successful payment and one same-actor replay prove one ledger row, one audit, one attachment, preserved file, actor, socio, category, and exact SHA-256            | Reused the existing atomic fixture and happy-path test; no standalone fixture or production change |

### Commands and Results

1. `pnpm install --frozen-lockfile` — passed; 788 packages linked; lockfile unchanged.
2. Safety net: `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.lease.test.ts` — passed, 3/3.
3. Safety net: `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts` — passed, 13/13.
4. Safety net: `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-mutations.atomic.test.ts` — passed, 4/4.
5. RED: focused lease command — failed as expected, 1 failed / 3 passed; actor B replay resolved with actor A's completed result.
6. GREEN: focused lease command — passed, 4/4.
7. Route triangulation: `pnpm --filter @athlos/api exec vitest run src/routes/ctacte-mutations.test.ts` — passed, 54/54; cross-actor replay is HTTP 409 `CONFLICT` and same-actor replay is 200.
8. PostgreSQL proof: focused atomic command — passed, 4/4; joined provenance and prior attachment preservation verified.
9. Final focused unit/route command: `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.lease.test.ts src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts src/routes/ctacte-mutations.test.ts` — passed, 71/71.
10. Final PostgreSQL atomic command — passed, 4/4.
11. `pnpm --filter @athlos/api typecheck` — passed (`tsc --noEmit`).
12. `git diff --check` — passed after progress and task persistence.

### Deviations from Design

- The original design/spec text mentions attachment-side `movementId`. The user-approved corrected S3.remainder scope supersedes it: existing payment `comprobanteAttachmentId` → attachment linkage is authoritative, so no FK or migration was added.
- No payment production change was needed. Existing `registerPayment` already short-circuits canonical replay before upload/compensation and already persists the attachment ID returned by provenance-aware upload.

### Remaining Tasks

Active S3.remainder implementation tasks: none. Historical/out-of-scope unchecked rows remain:

- [ ] 2.1 RED `ctacte-mutations.role.test.ts`: CONSULTA→403; ADMIN/TESORERO/OPERADOR pass
- [ ] 2.2 GREEN: `requireRole(['ADMIN','TESORERO','OPERADOR'])` on POST/DELETE mutations
- [ ] 2.3 RED `ctacte-comprobante.can_reprint.test.ts`: `can_reprint=false`→403
- [ ] 2.4 GREEN: `requirePermission('can_reprint')` on comprobante route
- [ ] 2.5 RED `ctacte-mutations.validation.test.ts`: bad UUID, blank/129-char key, bad date, money≤0, range inverted
- [ ] 2.6 GREEN: Zod normalize: trim, UUID regex, `isValidIsoCalendarDate`, `finite()>0`, key 1–128
- [ ] 2.7 REFACTOR: extract `validateMutationInput(input, kind)`
- [ ] 3.3 VERIFY + COMMIT + PR `S2.d: atomic addNote`; base = PR 7.
- [ ] 3.3 RED `emitter.ctacte.durable.test.ts`: same key after 30s → no new row
- [ ] 3.4 GREEN: covered-CTACTE hash `actorId|action|entityId|callerKey`; drop 10s bucket; 23505=dedup
- [ ] 3.7 REFACTOR: remove 10s-bucket helpers in `packages/audit/src/emitter.ts`
- [ ] 5.1 RED `ctacte-comprobante.timeout.test.ts`: fake clock +30s owner deadline → `failed`
- [ ] 5.2 GREEN: bound owner/follower wait to 30s; mark `failed`; emit structured `RENDER_TIMEOUT` log and increment `ctacte_comprobante_render_timeout_total`
- [ ] 5.3 RED `ctacte-comprobante.failed-replay.test.ts`: retry of failed job → 504
- [ ] 5.4 GREEN: route returns `504 {error:'RENDER_TIMEOUT',request_id}`
- [ ] 5.5 REFACTOR: centralize `LEASE_DURATION_MS = 30_000`

Parent-owned lifecycle actions remain deferred: bounded review, receipt handling, staging, commit, push, and PR.

### Workload / PR Boundary

- Slice implemented: corrected S3.remainder only.
- Runtime harness: disposable PostgreSQL at `localhost:5563` plus Fastify injection for the HTTP 409 boundary.
- Rollback boundary: revert the six files listed above to remove actor-bound replay, focused proofs, and S3.remainder artifact updates without affecting S3.foundation or S2.e.
- Measured final authored diff: 175 insertions + 14 deletions = 189 changed lines across six files, below the 400-line hard stop.

---

## S4a Apply Update — Failure-Reason State Foundation

### Status Consumed

- Workspace / only edit root: `/home/vlongo/work/athlos-worktrees/athlos-s4a-failure-reason`; branch `fix/ctacte-failure-reason-state`; base `origin/main@ed1bd16e7a7698688aff297bc5ca61a21c8cdb1d`.
- OpenSpec authoritative; strict TDD active; delivery `stacked-to-main` position 3/4. S4a only; S4b and lifecycle actions deferred.

### Completed Tasks / Persisted Checkboxes

- [x] 5a.1–5a.8: RED migration and lease contracts; GREEN migration/schema/state/stand-in; PostgreSQL triangulation; refactor; verify; budget/rollback.
- All eight implementation rows are visibly checked in `tasks.md`; parent and S4b rows remain byte-preserved.

### Files Changed

- `packages/db/drizzle/0035_ctacte_comprobante_failure_reason.sql`
- `packages/db/src/schema/tesoreria.ts`
- `packages/db/src/ctacte-comprobante-failure-reason.integration.test.ts`
- `apps/api/src/modules/socios/forms/ctacte-comprobante.ts`
- `apps/api/src/modules/socios/forms/ctacte-comprobante.lease.test.ts`
- `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts`
- `apps/api/src/modules/socios/forms/ctacte-comprobante.golden.test.ts`
- `apps/api/src/test-standins/db.ts`
- OpenSpec `tasks.md` and this cumulative `apply-progress.md`.

### TDD Cycle Evidence

| Tasks     | Layer                     | Safety net / RED                                                        | GREEN                                    | TRIANGULATE / REFACTOR                                                   |
| --------- | ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| 5a.1–5a.2 | Real PostgreSQL migration | RED 2/2: missing 0035 order and column                                  | 2/2 pass; 0035 twice, null/default/check | Existing/new rows and unsupported reason; local SQL/schema only          |
| 5a.3–5a.4 | Lease unit                | Safety 4/4; RED 1/5: missing `failOrdinary`                             | 5/5 pass                                 | Timeout/ordinary, stale, conflict, replay, both fence orders             |
| 5a.5–5a.6 | Two-client PostgreSQL     | Existing suite covered owner/stale/conflict; new transition proof added | 5/5 pass                                 | Owner-only failures, terminal replay, ordinary reclaim, both race orders |

### Commands / Results

- `pnpm install --frozen-lockfile` — passed; lockfile unchanged.
- Focused DB command with `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test` — RED 2/2, then GREEN 2/2, final 2/2.
- Focused lease command — safety 4/4, RED 1/5, GREEN/final 5/5.
- Focused PostgreSQL lease command with the same URL — final 5/5.
- `pnpm --filter @athlos/api typecheck` — passed after updating the golden stand-in API.
- `git diff --check` — passed. S4b scope command against `ed1bd16...` printed nothing.

### Deviations / Boundary / Rollback

- No behavior deviation. The golden-test lease stand-in was an additional compile-time parity path beyond the seven forecast paths.
- No 30-second deadline, abort, route, metrics, 504, timeout-log, or `PdfGenerator` behavior was added.
- Rollback reverts the application/schema declarations and S4a tests/stand-ins together; an applied additive 0035 remains and may only be retired by a future forward migration.

### Remaining Tasks

- S4b implementation rows 5b.1–5b.11 remain unchecked in `tasks.md` and are blocked until S4a merges.
- Parent-owned deferred rows remain unchanged: bounded review/receipt/lifecycle for S4a; merge S4a and record its SHA; later S4b review/lifecycle; final historical reconciliation.
- Historical unchecked S1/S2 rows remain exact in `tasks.md` and are excluded from S4a.

### Workload / PR Boundary

- Code/test authored budget: 256 changed lines. Candidate before this progress append: 272 changed lines; final candidate remains below 400.
- Runtime harness: disposable PostgreSQL on `localhost:5563`, with migration idempotence and two independent lease clients proven.

## S4b Fixture-Prerequisite Apply Update

- **Status/scope:** strict-TDD fixture-only slice from S4a merge `739a8d4`; six support/self-test files plus OpenSpec, with no runtime/schema behavior.
- **Tasks:** 5b.9a–5b.9d are `[x]`; S4b behavior and parent rows remain unchecked and blocked until this prerequisite merges.
- **RED → GREEN:** three missing-module suites failed, then the three support suites passed 6/6.
- **Triangulate:** timer/deferred reset, PDF settlement/cleanup, and bounded zero-label telemetry capture passed; combined baseline passed 71/71 and real-PG comprobante passed 5/5.
- **Static/scope:** API typecheck and diff checks passed; no deadline, abort runtime, 504, log, counter, schema, migration, or S4a change.
- **Boundary:** final candidate is 350 lines, within the ≤350 fixture gate; rollback removes only the six fixture files and this prerequisite artifact update.
- **Deferred:** tasks 5b.1–5b.8 and 5b.10–5b.11 remain for S4b; Engram persistence was unavailable.

## S4b Isolated PostgreSQL Harness Prerequisite Update
- **Scope:** branch `test/ctacte-s4b-isolated-schema-harness`, base `9696634`; four paths only and no production/runtime/migration edits.
- **Tasks checked:** new prerequisite rows 5b.9e–5b.9f only; 5b.1–5b.8 and 5b.10–5b.11 remain unchecked.
- **RED:** focused suite failed on the absent `ctacte-comprobante.postgres-harness.test-support.ts` module.
- **GREEN:** focused real-PostgreSQL harness suite passed 1/1.
- **Primitive proof:** random 96-bit owned schema; `_test` database guard before writes; bounded barrier entry/release; full durable retry snapshot; parameterized fenced audit publication; bounded unique key/entity audit polling.
- **State proof:** post-timeout full snapshot stayed equal after released late completion; result fields remained null, attempt/update metadata was retained, and printed audit remained zero.
- **Cleanup proof:** generated schema existed before cleanup and not after; pre-existing `tesoreria` existence was unchanged; initialization cleanup closes all created pools and drops only the validated owned schema.
- **TRIANGULATE:** existing `ctacte-comprobante.postgres.integration.test.ts` passed 5/5.
- **Static validation:** API typecheck and tracked/untracked diff checks passed; exact scope was four expected paths; final authored count including untracked files was 341 lines.
- **Rollback:** remove the two new harness files and revert only this subsection plus rows 5b.9e–5b.9f; no deployed behavior changes.
- **Claim boundary:** prerequisite primitives only; actual S4b follower-timeout behavior and row 5b.7 are not proven.
- **Apply-gate correction:** RED 1/1 rejected with `barrier release timed out`; harness-owned barrier tracking now releases pending work before pool/schema cleanup, GREEN passed 1/1, PostgreSQL baseline 5/5, API typecheck and `git diff --check` passed; final committed authored count is 355 after mandatory formatting hooks.

## S4b Behavior Apply Attempt — Blocked During RED

- **Status/scope:** branch `feat/ctacte-s4b-timeout-runtime`, exact base `9696634`; S4a merge `739a8d4` is in first-parent history and the base is an ancestor of `HEAD`. Strict TDD was active. No production code, task checkbox, lifecycle row, commit, push, or PR was changed.
- **RED evidence:** added focused timeout coordinator, PDF cancellation, route/telemetry, and PostgreSQL race expectations. Timeout suite observed 4/4 intended failures; PDF suite observed 2 intended failures with 6 baseline passes; route suite failed before collection because its server import could not resolve `puppeteer` in that Vitest context.
- **Technical blocker:** required disposable PostgreSQL command failed before tests with `ECONNREFUSED` for both `::1:5563` and `127.0.0.1:5563`; all 6 PostgreSQL cases were skipped. Per task contract, apply stopped rather than claiming success or writing GREEN implementation.
- **Boundary:** current authored candidate is 244 lines against `9696634` (93 tracked changed lines plus 151 lines in two intended untracked tests), below the 400-line hard stop. `git diff --check` passes.
- **Remaining:** all 5b.1–5b.8 and 5b.10–5b.11 rows remain unchecked. Resume only with the authorized disposable PostgreSQL service available, then complete GREEN/triangulation/refactor and all final evidence.
- **Rollback:** remove the two new S4b test files and revert the focused additions in `pdf-generator.test.ts` and `ctacte-comprobante.postgres.integration.test.ts`; this leaves S4a, `0035`, and the merged fixture prerequisite intact.

## S4b Behavior Apply Completion

- **Status/scope:** resumed on `feat/ctacte-s4b-timeout-runtime` from exact base `9696634`; S4a merge `739a8d4` remains an ancestor. The active 5b.1–5b.8 and 5b.10–5b.11 work completed the previously proven 5b.9 fixture gate; historical S1/S2 and parent lifecycle rows remain unchanged.
- **GREEN:** `ctacte-comprobante.ts` now uses one fixed 30-second request deadline, renewable 5-second owner lease heartbeats, owner/follower fencing, abort propagation, observed late settlement, terminal replay typing, and ordinary-failure reclaim semantics. `pdf-generator.ts` checks cancellation around semaphore acquisition and closes the concrete page idempotently while always releasing the slot.
- **HTTP/telemetry:** the route maps only `ComprobanteRenderTimeoutError` to the standard `504 RENDER_TIMEOUT` envelope, logs distinct bounded owner/follower events, increments `ctacte_comprobante_render_timeout_total` exactly once for live deadlines, never recounts persisted replay, and rethrows unexpected failures to the global redacted 5xx handler. Runtime Prometheus exposition was asserted to contain the counter type and no labeled sample.
- **TRIANGULATE/REFACTOR:** the real PostgreSQL two-client suite proves exactly one completion/timeout winner and follower non-mutation; the existing lease suite preserves ordinary reclaim, terminal replay, conflict, and stale-owner fencing. Deadline/lease constants, typed timeout error, timer cleanup, and abort cleanup are centralized in the S4b runtime files.
- **Final focused command:** `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.timeout.test.ts src/modules/socios/forms/pdf-generator.test.ts src/routes/ctacte-comprobante.timeout.test.ts src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts` passed 4 files / 23 tests. Additional lease regression command passed 1 file / 5 tests.
- **Static evidence:** `pnpm --filter @athlos/api typecheck` passed; `git diff --check` passed. Final authored S4b application/test count against `9696634` is 390 lines: 255 tracked additions/deletions plus 135 lines in the two intended untracked tests. This is at the upper bound of the 320–390 target and below the 400-line hard stop.
- **Completed rows:** all implementation-owned 5b.1–5b.11 rows are `[x]` in `tasks.md`, including the previously proven fixture gate and 5b.9a–5b.9d prerequisite. Parent review/merge/lifecycle rows remain unchecked.
- **Rollback:** revert together `ctacte-comprobante.ts`, `ctacte-comprobante.timeout.test.ts`, `pdf-generator.ts`, `pdf-generator.test.ts`, `ctacte-mutations.ts`, `ctacte-comprobante.timeout.test.ts`, `metrics.ts`, and `ctacte-comprobante.postgres.integration.test.ts`. S4a and forward-only `0035` remain deployed and inert; ordinary failures retain null-reason reclaim semantics, and timeout HTTP/telemetry behavior is removed.

## S4b Apply Gate Corrective Rerun — Blocked on Direct Proof Budget

- **Gate failure:** fresh-context validation rejected live owner telemetry after a lost owner failed to win `failTimeout`, and rejected indirect/insufficient proof for 5b.1 and 5b.7.
- **Corrective runtime fix:** lost-owner reconciliation now returns a non-live typed timeout when no complete result wins. The deterministic takeover test forces `failTimeout` to return false and proves `{ role: 'owner', live: false }`, so the route cannot emit or count a live owner timeout for a transition this request did not win.
- **Corrective validation:** the four focused suites pass 4 files / 23 tests; the lease regression passes 1 file / 5 tests; API typecheck and `git diff --check` pass. The route suite still executes the Prometheus exposition assertion proving `ctacte_comprobante_render_timeout_total` has no labels. Disposable PostgreSQL executes 6/6 existing cases.
- **Honest task state:** 5b.1, 5b.7, and dependent completion row 5b.10 were returned to `[ ]`. Current tests do not directly prove every 5b.1 ordering/late-settlement case, and the PostgreSQL suite does not yet drive an actual follower request to its deadline with synchronization barriers or assert that a fenced late render emits no printed audit. Other genuinely proven S4b rows remain checked; parent rows remain untouched.
- **Budget:** exact application/test candidate remains 390 authored lines against `9696634` (255 tracked additions/deletions plus 135 intended untracked lines). Completing the missing direct runtime/PostgreSQL proofs cannot be represented honestly within the remaining nine-line hard-stop margin without deleting meaningful coverage.
- **Required next split:** replan S4b into a behavior slice and a dependent proof slice, or extract an additional no-behavior synchronization/audit test harness prerequisite, so direct fake-clock orderings and real-PostgreSQL follower-timeout/printed-audit fencing tests can land without a size exception. Do not mark 5b.1, 5b.7, or 5b.10 complete until those proofs pass.

## S4b-runtime Work Unit Evidence

- **Status/scope:** verified on `feat/ctacte-s4b-timeout-runtime` against `cf1d3c15fcddf0e8c6164d82147e267a4075d7ca`. The runtime diff is exactly six app/test paths: `ctacte-comprobante.ts`, `ctacte-comprobante.timeout.test.ts`, `pdf-generator.ts`, `pdf-generator.test.ts`, `ctacte-mutations.ts`, and `metrics.ts`.
- **Proof isolation:** `s4b-proof-after-runtime-cf1d3c1` preserves exactly `ctacte-comprobante.postgres.integration.test.ts` (50 lines) and `routes/ctacte-comprobante.timeout.test.ts` (78 lines). Its contents were inspected with `git stash show --include-untracked`; it was not applied. Existing recovery stash `runtime-s4b-before-main-cf1d3c1` was not touched.
- **Budget:** `git diff --numstat` against the base reports 237 tracked authored lines; the untracked coordinator test adds 114 lines, for **351** exact app/test lines. No other app/test path is present in the runtime worktree diff.
- **Commands/results:**
  - `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.timeout.test.ts src/modules/socios/forms/pdf-generator.test.ts` — passed, 2 files / 13 tests.
  - `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.lease.test.ts` — passed, 1 file / 5 tests.
  - `pnpm --filter @athlos/api exec vitest run src/routes/ctacte-mutations.test.ts` — passed, 1 file / 54 tests.
  - `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts src/modules/socios/forms/ctacte-comprobante.postgres-harness.test.ts` — passed unchanged runtime harness baselines, 2 files / 6 tests.
  - `pnpm --filter @athlos/api typecheck` — passed.
  - `git diff --check` — passed.
- **Task boundary:** 5b.2–5b.6, 5b.8, 5b.9a–5b.9f, and 5b.11 remain as persisted; 5b.1, 5b.7, 5b.10, and 5b.12 remain unchecked. The route-timeout test is proof-only and is not claimed as runtime evidence.
- **Rollback/deploy:** revert the six runtime paths together. Retain S4a, `0035`, fixtures, harness, and the proof stash. Runtime is ready for its issue/PR boundary but **MUST NOT deploy** before S4b-proof closes 5b.1, 5b.7, and 5b.10.
