# Tasks: Athlos CTACTE Security and Reliability Remediation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600–750 remaining across S4a and S4b |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | S4a failure-reason foundation → S4b deadline/HTTP/telemetry |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
Delivery strategy: auto-chain

### Work Units (stacked-to-main, ≤400 changed lines each)

- **S0/PR 1** specs+0034 lifecycle. Test `pnpm --filter @athlos/db exec vitest run src/s0-contracts-0034-lifecycle.test.ts` (disposable PG via `ATHLOS_TEST_DATABASE_URL`; spec-delta validator and 0034 lifecycle proof live in the same vitest file per the v2 corrective batch — there is no separate `scripts/check-spec-deltas.mjs` or `0034.lifecycle.test.ts`). Rollback: `openspec/changes/athlos-ctacte-security-reliability-remediation/` + `packages/db/src/s0-contracts-0034-lifecycle.test.ts` + `artifacts/`.
- **S1/PR 2** auth/validation. Test `pnpm --filter @athlos/api test:run -- ctacte-mutations.role ctacte-comprobante.can_reprint ctacte-mutations.validation`. Rollback: `routes/ctacte-mutations.ts`+3 tests.
- **S2/PR 3** atomic audit+caller key. Test `pnpm --filter @athlos/api test:run -- ctacte-mutations.atomic emitter.ctacte.durable ctacte_movement_notes_repository.concurrent`. Receipts `artifacts/s2/`. Rollback: service+emitter+repo+4 tests.
- **S3/PR 4** attachment comp+actor replay. Test `pnpm --filter @athlos/api test:run -- attachments.compensation ctacte_movement_notes.provenance ctacte-comprobante.actor-binding ctacte-comprobante.prior-attachment`. Receipts `artifacts/s3/`. Rollback: `attachments.ts`+`forms/ctacte-comprobante.ts`+`ctacte_movement_notes.ts`+4 tests.
- **S4a/next PR** failure-reason schema/state foundation from `origin/main@1fb0ca0`; 280–360 lines, hard stop before 400. S4a must merge to `main` before S4b and must not enable timeout HTTP behavior.
- **S4b/following PR** fixed 30s deadline, abort cleanup, `504`, logs, and zero-label metric from S4a's merged mainline base; 320–390 lines, hard stop before 400, with fixture-only prerequisite extraction if apply forecast exceeds 350.

## S0 — Contracts

- [x] 1.1 RED `s0-contracts-0034-lifecycle.test.ts` (spec-shape describe): 6 deltas, RFC 2119, Given/When/Then
- [x] 1.2 GREEN: author 6 delta specs in `openspec/changes/.../specs/*`
- [x] 1.3 RED `s0-contracts-0034-lifecycle.test.ts` (0034 RED describe): reject missing predecessors/integrity evidence before accepting `0034`
- [x] 1.4 GREEN: apply `0031→0032→0033→0034` twice; deterministically capture and assert `pg_indexes` evidence with no `WHERE`
- [x] 1.5 REFACTOR: align every scenario to Given/When/Then

## S1 — Authorization and Validation

- [ ] 2.1 RED `ctacte-mutations.role.test.ts`: CONSULTA→403; ADMIN/TESORERO/OPERADOR pass
- [ ] 2.2 GREEN: `requireRole(['ADMIN','TESORERO','OPERADOR'])` on POST/DELETE mutations
- [ ] 2.3 RED `ctacte-comprobante.can_reprint.test.ts`: `can_reprint=false`→403
- [ ] 2.4 GREEN: `requirePermission('can_reprint')` on comprobante route
- [ ] 2.5 RED `ctacte-mutations.validation.test.ts`: bad UUID, blank/129-char key, bad date, money≤0, range inverted
- [ ] 2.6 GREEN: Zod normalize: trim, UUID regex, `isValidIsoCalendarDate`, `finite()>0`, key 1–128
- [ ] 2.7 REFACTOR: extract `validateMutationInput(input, kind)`

## S2 — Atomic Audit and Caller-Key Idempotency

> v2 replan note (per Engram #581): S2 was split into S2.a (durable caller-key idempotency, merged PR #48), S2.b (concurrent same-key dedup, merged PR #50), S2.c (atomic registerPayment, this slice), S2.d (atomic addNote), S2.e (atomic registerDebit). S3 was split into S3.foundation (compensation primitive, merged PR #54) and S3.remainder (actor-binding + provenance). S2.c was blocked on S3.foundation; with #54 merged, S2.c can land.

### Phase 3: S2.d -- Atomic addNote (PR 8, base = PR 7 merged)

- [x] 3.1 RED-GREEN apps/api/src/modules/socios/ctacte_movement_notes.ts -- wrap insertNote + emitNoteAddedAudit in db.transaction(...); widen emitNoteAddedAudit to (dbOrTx, ..., { callerKey }); drop best-effort try/catch.
- [x] 3.2 EXTEND two test files (mock db transaction wrapper + wrapPool proxies pool.connect(), ~53 line fixture).
- [ ] 3.3 VERIFY + COMMIT + PR `S2.d: atomic addNote`; base = PR 7.

### Phase 4: S2.e -- Atomic registerDebit (PR 9, base = PR 8 merged)

- [x] 4.1 RED focused registerDebit unit tests -- require one transaction handle for ledger + audit, callerKey propagation, propagated audit failure, and no attachment compensation.
- [x] 4.2 GREEN `apps/api/src/modules/socios/forms/ctacte-mutations.ts` -- wrap debit insert + `CTACTE_DEBIT_REGISTERED` audit in `db.transaction`; pass `tx` and caller key; remove best-effort audit swallowing.
- [x] 4.3 TRIANGULATE disposable PostgreSQL atomic tests -- prove happy debit + audit commit and forced-audit-failure rollback of both, with no debit attachment compensation.
- [x] 4.4 REFACTOR local atomic-audit documentation; no S3, S4, emitter cleanup, or unrelated implementation.
- [x] 4.5 VERIFY focused unit + PostgreSQL atomic suites, API typecheck, and diff hygiene; parent owns review/commit/push/PR lifecycle.

- [x] 3.1 RED `ctacte-mutations.atomic.test.ts` (S2.c): audit throw rolls back payment + compensates comprobante (disposable PG, 2 cases: happy commit + tx-rollback-compensate)
- [x] 3.2 GREEN (S2.c subset, registerPayment only): wrap insert+`emitAudit(tx,…)` in `db.transaction`; compensate orphaned comprobante via imported `compensateNewAttachment` (S3.foundation). `registerDebit` + `addNote` deferred to S2.d/S2.e (not in this slice per user directive).
- [ ] 3.3 RED `emitter.ctacte.durable.test.ts`: same key after 30s → no new row
- [ ] 3.4 GREEN: covered-CTACTE hash `actorId|action|entityId|callerKey`; drop 10s bucket; 23505=dedup
- [x] 3.5 RED `ctacte_movement_notes_repository.concurrent.test.ts`: 2 parallel same-key → 1 row
- [x] 3.6 GREEN: keep `ON CONFLICT (idempotency_key) DO NOTHING`; preserve non-CTACTE semantics
- [ ] 3.7 REFACTOR: remove 10s-bucket helpers in `packages/audit/src/emitter.ts`

## S3 — Attachment Compensation and Actor-Bound Replay

> S3.foundation was merged in PR #54. S3.remainder uses the existing payment → attachment relationship; it adds no attachment-side `movementId`, foreign key, or migration.

- [x] 4.1 S3.foundation RED: prove failed payment persistence removes the newly uploaded attachment row and file.
- [x] 4.2 S3.foundation GREEN: add the retry-safe `compensateNewAttachment` primitive used by `registerPayment`.
- [x] 4.3 RED actor-bound comprobante replay: actor B replaying actor A's completed key conflicts while actor A can replay it.
- [x] 4.4 GREEN actor-bound comprobante replay: include `operatorId` in the request fingerprint/ownership decision without weakening lease semantics.
- [x] 4.5 PROVE payment attachment provenance through `registerPayment`: payment `comprobanteAttachmentId` links to attachment `socioId`, `uploadedBy`, `category`, and SHA-256; add production code only if the proof exposes a gap.
- [x] 4.6 PROVE prior-attachment preservation through `registerPayment`: replay never compensates or deletes the attachment persisted by a prior successful payment.

## S4 — Comprobante Timeout and Failure Observability

> The stale single-slice S4 plan is superseded by two independently reviewable stacked-to-main work units. S4a starts from `origin/main@1fb0ca0`; S4b starts only after S4a is merged to `main`. Historical unchecked S1/S2 lifecycle and emitter rows remain unchanged and are excluded from S4 apply; reconcile them only during final change closeout.

### S4a — Failure-Reason Schema and State Foundation

**Start:** `origin/main@1fb0ca0`. **Finish:** migration `0035`, Drizzle/stand-in parity, and reason-aware lease transitions are independently green; timeout HTTP/deadline/telemetry behavior remains disabled. **Budget:** 280–360 authored changed lines, hard stop before 400. **Review risks:** migration idempotence/order/backfill/check correctness; SQL versus stand-in drift; conflict precedence and owner fencing races.

Expected files and approximate authored lines:

| Path | Expected lines |
|---|---:|
| `packages/db/drizzle/0035_ctacte_comprobante_failure_reason.sql` | 20–35 |
| `packages/db/src/schema/tesoreria.ts` | 5–15 |
| `packages/db/src/ctacte-comprobante-failure-reason.integration.test.ts` | 55–80 |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` | 45–65 |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.lease.test.ts` | 45–65 |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts` | 60–85 |
| `apps/api/src/test-standins/db.ts` | 15–30 |

- [x] 5a.1 RED — In `packages/db/src/ctacte-comprobante-failure-reason.integration.test.ts`, create pre-0035 `rendering`, `complete`, and `failed` rows; first prove the focused test fails because `failure_reason`/its named check are absent, then specify ordered `0031 → 0032 → 0033 → 0034 → 0035`, apply-0035-twice idempotence, nullable `text DEFAULT NULL`, null backfill/default, and rejection of unsupported values. Run `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/db exec vitest run src/ctacte-comprobante-failure-reason.integration.test.ts`; record the expected RED assertions. <!-- sdd-owner: implementation -->
- [x] 5a.2 GREEN — Add hand-written `packages/db/drizzle/0035_ctacte_comprobante_failure_reason.sql` with `ADD COLUMN IF NOT EXISTS failure_reason text DEFAULT NULL`, a catalog-guarded named check allowing only `NULL`/`RENDER_TIMEOUT`, and explicit validation; update nullable Drizzle metadata in `packages/db/src/schema/tesoreria.ts`. Rerun the focused DB command until all migration assertions pass without editing prior migrations or the incomplete production journal. <!-- sdd-owner: implementation -->
- [x] 5a.3 RED — Extend `apps/api/src/modules/socios/forms/ctacte-comprobante.lease.test.ts` to fail on the missing `terminal-timeout` claim and explicit `failOrdinary`/`failTimeout` APIs. Cover timeout replay without reclaim, ordinary `failed + NULL` reclaim, stale rendering takeover, same-actor completed replay, actor/payload conflict precedence, and both complete-versus-timeout owner-fence orders. Run `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.lease.test.ts` and retain the failing evidence before production edits. <!-- sdd-owner: implementation -->
- [x] 5a.4 GREEN — In `apps/api/src/modules/socios/forms/ctacte-comprobante.ts`, implement nullable failure-reason state, `terminal-timeout`, owner-conditional `failOrdinary` and `failTimeout`, reason clearing on `complete`, and conflict-before-replay/reclaim ordering; update `apps/api/src/test-standins/db.ts` to the same transition table. Do not add a 30-second deadline, `504` route mapping, timeout logging, metrics, or `PdfGenerator` cancellation in S4a. Rerun the focused lease suite to GREEN. <!-- sdd-owner: implementation -->
- [x] 5a.5 TRIANGULATE — In `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts`, use two independent PostgreSQL clients to prove owner-only timeout/ordinary failure updates, terminal replay, ordinary reclaim, stale takeover, actor/payload conflict precedence, and exactly one winner for `complete` versus `failTimeout`; assert a stale owner cannot publish. Run `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts`. <!-- sdd-owner: implementation -->
- [x] 5a.6 REFACTOR — Deduplicate only local lease-row builders/transition assertions across `ctacte-comprobante.lease.test.ts`, `ctacte-comprobante.postgres.integration.test.ts`, and `apps/api/src/test-standins/db.ts`; preserve SQL/stand-in parity and rerun the DB, lease, and PostgreSQL commands after refactoring. <!-- sdd-owner: implementation -->
- [x] 5a.7 VERIFY — Run `pnpm --filter @athlos/api typecheck`, `git diff --check`, and `git diff --name-only 1fb0ca0 -- apps/api/src/routes/ctacte-mutations.ts apps/api/src/plugins/metrics.ts apps/api/src/modules/socios/forms/pdf-generator.ts`; the final command must print nothing, proving S4a did not enable timeout HTTP behavior. Record runtime evidence from disposable PostgreSQL, or stop if that harness is unavailable. <!-- sdd-owner: implementation -->
- [x] 5a.8 BUDGET/ROLLBACK — Count authored code/test lines with `git diff --numstat 1fb0ca0 -- packages/db apps/api | awk '$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {n+=$1+$2} END {print n+0}'`; target 280–360 and stop before 400. Rollback reverts the seven S4a paths above together while leaving an already-applied additive `0035` in PostgreSQL; retire it only through a future forward migration. <!-- sdd-owner: implementation -->

### S4b — Fixed Deadline, Abort Cleanup, HTTP, and Telemetry

**Dependency/start:** S4a merged to `main`; discover and record its merge SHA from `git log --first-parent -- packages/db/drizzle/0035_ctacte_comprobante_failure_reason.sql`, then verify it is an ancestor of the S4b base. **Finish:** fixed request deadlines, abort/resource cleanup, fenced timeout outcomes, `504`, logs, metric, and redacted unexpected `5xx` are independently green. **Budget:** 320–390 authored changed lines, hard stop before 400. If the apply forecast exceeds 350, extract fixture-only setup into a prerequisite stacked-to-main work unit before continuing S4b. **Review risks:** Chromium/process cleanup, late promise settlement, fake-clock determinism, owner/follower mutation boundaries, telemetry double-count/cardinality, and accidental internal-error downgrade or disclosure.

Expected files and approximate authored lines:

| Path | Expected lines |
|---|---:|
| `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` | 65–90 |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.timeout.test.ts` | 65–90 |
| `apps/api/src/modules/socios/forms/pdf-generator.ts` | 25–40 |
| `apps/api/src/modules/socios/forms/pdf-generator.test.ts` | 40–55 |
| `apps/api/src/routes/ctacte-mutations.ts` | 15–25 |
| `apps/api/src/routes/ctacte-comprobante.timeout.test.ts` | 40–55 |
| `apps/api/src/plugins/metrics.ts` | 5–10 |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts` | 30–45 |

- [ ] 5b.1 RED — In `apps/api/src/modules/socios/forms/ctacte-comprobante.timeout.test.ts`, introduce an injectable fake clock and first fail at 29,999/30,000 ms for one fixed `REQUEST_DEADLINE_MS = 30_000` across claim, follower polling, takeover, semaphore wait, and render; keep `LEASE_DURATION_MS = 5_000` with renewable heartbeats that never extend the request deadline. Cover timely owner success, owner timeout transition, follower timeout with zero durable writes, stale takeover using only remaining budget, stored terminal replay without rerender, ordinary failure/reclaim, both completion-timeout orders, cleared timers/heartbeats, and observed late resolve/reject. Run `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.timeout.test.ts` and retain RED evidence. <!-- sdd-owner: implementation -->
- [ ] 5b.2 GREEN — In `apps/api/src/modules/socios/forms/ctacte-comprobante.ts`, add the fixed-deadline coordinator, short renewable lease heartbeat, `AbortController`, and always-observed render task. Only an active owner may call owner-conditional `failTimeout`; a follower deadline performs no mutation; a lost owner reconciles the winning complete/terminal state; a late fenced completion cannot publish bytes or printed audit. Rerun the fake-clock suite to GREEN. <!-- sdd-owner: implementation -->
- [ ] 5b.3 RED — Extend `apps/api/src/modules/socios/forms/pdf-generator.test.ts` to fail for abort before semaphore acquisition, abort during `setContent`, abort during `page.pdf`, idempotent page close, listener removal, slot release, observed late rejection, and a successful render after each cancellation path. Run `pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/pdf-generator.test.ts`. <!-- sdd-owner: implementation -->
- [ ] 5b.4 GREEN — Update `apps/api/src/modules/socios/forms/pdf-generator.ts` to accept an `AbortSignal`, check it around semaphore acquisition, close the concrete Puppeteer page on abort, remove listeners, close open pages, and release the slot in `finally`. A `Promise.race` may select an outcome but is insufficient without abort, cleanup, fencing, and late-settlement observation. Rerun the focused PDF suite to GREEN. <!-- sdd-owner: implementation -->
- [ ] 5b.5 RED — In `apps/api/src/routes/ctacte-comprobante.timeout.test.ts`, use Fastify injection to fail on missing standard owner/follower `504` envelopes (`error`, human-readable `message`, current `request_id`), missing structured owner/follower warning fields, incorrect live-timeout increments, replay recounting, metric labels, and unexpected comprobante errors incorrectly converted to `400` instead of the global redacted `5xx`. Run `pnpm --filter @athlos/api exec vitest run src/routes/ctacte-comprobante.timeout.test.ts`. <!-- sdd-owner: implementation -->
- [ ] 5b.6 GREEN — In `apps/api/src/routes/ctacte-mutations.ts`, map only typed `ComprobanteRenderTimeoutError` to the standard `504 RENDER_TIMEOUT` envelope and rethrow all unexpected comprobante errors; in `apps/api/src/plugins/metrics.ts`, register zero-label `ctacte_comprobante_render_timeout_total`. Emit/count once for a live owner transition win or live follower deadline, never for persisted timeout replay or ordinary failure, and use distinct owner-render-failed versus follower-wait-timeout events. Rerun the focused route suite to GREEN. <!-- sdd-owner: implementation -->
- [ ] 5b.7 TRIANGULATE — Extend `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts` with synchronization barriers and two stores/clients to prove an owner timeout fences late completion/printed audit and a healthy owner is unchanged by follower timeout; use no wall-clock duration assertions. Run `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts`. <!-- sdd-owner: implementation -->
- [ ] 5b.8 REFACTOR — Centralize only the deadline/lease constants, typed timeout error, timer cleanup, and bounded test fixtures in the S4b files; keep request deadline distinct from lease duration and rerun the timeout, PDF, route, and PostgreSQL suites after refactoring. <!-- sdd-owner: implementation -->
- [ ] 5b.9 FIXTURE GATE — Recount the forecast before behavior edits and after each RED fixture. If projected authored lines exceed 350, stop, move only reusable fake-clock/browser/Fastify fixture code into a separate prerequisite stacked-to-main work unit with its own baseline tests and rollback, merge it, then restart S4b from that mainline base; do not move behavior or request a size exception. <!-- sdd-owner: implementation -->

#### S4b Fixture Prerequisite (authorized extraction tied to 5b.9)

- [x] 5b.9a RED — Add self-tests that import the absent comprobante clock/deferred/lease, PDF browser/page/abort, and Fastify log/metric support contracts; retain missing-module failures before helper creation. <!-- sdd-owner: implementation -->
- [x] 5b.9b GREEN/TRIANGULATE — Implement only reusable deterministic test support, including explicit advance/flush, observed deferred settlement, cleanup/listener state, bounded telemetry capture, reset cases, and no runtime timeout behavior. <!-- sdd-owner: implementation -->
- [x] 5b.9c VERIFY — Run the three support self-tests, existing lease/PDF/route/real-PG baselines, API typecheck, and exact no-production-change scope proof. <!-- sdd-owner: implementation -->
- [x] 5b.9d BUDGET/ROLLBACK — Keep the entire fixture candidate at or below 350 changed lines; rollback removes only the six support/self-test files and this prerequisite artifact update. <!-- sdd-owner: implementation -->

- [ ] 5b.10 VERIFY — Run the four focused suites above, `pnpm --filter @athlos/api typecheck`, and `git diff --check`; inspect Prometheus exposition to prove `ctacte_comprobante_render_timeout_total` has no labels and record disposable-PostgreSQL runtime evidence. Count from the recorded S4a merge base with `git diff --numstat <S4A_MERGE_SHA> -- apps/api | awk '$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {n+=$1+$2} END {print n+0}'`; target 320–390 and hard-stop before 400. <!-- sdd-owner: implementation -->
- [ ] 5b.11 ROLLBACK — Revert the eight S4b paths together; S4a and forward-only `0035` remain deployed and inert, ordinary failures retain null reasons/reclaim semantics, and no timeout HTTP/telemetry behavior remains. <!-- sdd-owner: implementation -->

### Parent Actions After S4 Implementation

- [ ] After S4a apply evidence is complete and under 400 lines, start or reuse the bounded review for the exact S4a target, then perform receipt validation and stacked-to-main lifecycle gates without changing the reviewed scope. <!-- sdd-owner: parent -->
- [ ] Merge S4a to `main` before authorizing S4b; record the merge SHA/base evidence and reject a polluted S4b diff containing S4a or unrelated historical rows. <!-- sdd-owner: parent -->
- [ ] After S4b apply evidence is complete and under 400 lines, start or reuse the high-risk bounded review for the exact S4b target, including process cleanup and race evidence, then perform receipt validation and stacked-to-main lifecycle gates without reopening review. <!-- sdd-owner: parent -->
- [ ] During final change reconciliation only, resolve historical unchecked S1/S2 lifecycle and emitter rows against merged evidence; do not treat them as S4 implementation or mark them complete from S4 results. <!-- sdd-owner: parent -->

## Phase 2: S2.c — Route Error Contract (additive; size:exception preserved)

> S2.c review finding: parked candidate's `registerPayment`/`registerDebit` catches (L256-260, L333-336) squash non-`ErrorCode` audit/DB-rollback into 400. Correct: `addNote` L445 / `softDeleteNote` L505 `throw err` → redacted 5xx.

- [x] 2.1 RED `apps/api/src/routes/ctacte-mutations.route-error-contract.test.ts` — mock both fns to throw non-`ErrorCode` (audit/DB-rollback); assert 5xx, NOT 400 `VALIDATION_ERROR`.
- [x] 2.2 GREEN `apps/api/src/routes/ctacte-mutations.ts` — drop 400 fallback for non-`ErrorCode` throws in both catches; `throw err` → redacted 5xx. Preserve CONFLICT/VALIDATION_ERROR/NOT_FOUND/UNSUPPORTED_MEDIA_TYPE.
