# Tasks: Athlos CTACTE Security and Reliability Remediation

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
Delivery strategy: auto-chain | Split: S0→S1→S2→S3→S4 | Est: 1800–2400 lines

### Work Units (stacked-to-main, ≤400 changed lines each)

- **S0/PR 1** specs+0034 lifecycle. Test `pnpm --filter @athlos/db exec vitest run src/s0-contracts-0034-lifecycle.test.ts` (disposable PG via `ATHLOS_TEST_DATABASE_URL`; spec-delta validator and 0034 lifecycle proof live in the same vitest file per the v2 corrective batch — there is no separate `scripts/check-spec-deltas.mjs` or `0034.lifecycle.test.ts`). Rollback: `openspec/changes/athlos-ctacte-security-reliability-remediation/` + `packages/db/src/s0-contracts-0034-lifecycle.test.ts` + `artifacts/`.
- **S1/PR 2** auth/validation. Test `pnpm --filter @athlos/api test:run -- ctacte-mutations.role ctacte-comprobante.can_reprint ctacte-mutations.validation`. Rollback: `routes/ctacte-mutations.ts`+3 tests.
- **S2/PR 3** atomic audit+caller key. Test `pnpm --filter @athlos/api test:run -- ctacte-mutations.atomic emitter.ctacte.durable ctacte_movement_notes_repository.concurrent`. Receipts `artifacts/s2/`. Rollback: service+emitter+repo+4 tests.
- **S3/PR 4** attachment comp+actor replay. Test `pnpm --filter @athlos/api test:run -- attachments.compensation ctacte_movement_notes.provenance ctacte-comprobante.actor-binding ctacte-comprobante.prior-attachment`. Receipts `artifacts/s3/`. Rollback: `attachments.ts`+`forms/ctacte-comprobante.ts`+`ctacte_movement_notes.ts`+4 tests.
- **S4/PR 5** 30s/504. Test `pnpm --filter @athlos/api test:run -- ctacte-comprobante.timeout ctacte-comprobante.failed-replay`. Rollback: `forms/ctacte-comprobante.ts`+route envelope.

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

- [ ] 4.1 RED `attachments.compensation.test.ts`: audit fail → row deleted + file unlinked (tmpdir+disposable PG)
- [ ] 4.2 GREEN: add `compensateNewAttachment(tx,rowId,path)` scoped to current tx
- [ ] 4.3 RED `ctacte_movement_notes.provenance.test.ts`: row persists socioId/uploadedBy/category/sha256/movementId
- [ ] 4.4 GREEN: extend attachment insert for provenance + movementId FK
- [ ] 4.5 RED `ctacte-comprobante.actor-binding.test.ts`: actor B replay of A → 409
- [ ] 4.6 GREEN: include `operatorId` in fingerprint + ownership check
- [ ] 4.7 RED `ctacte-comprobante.prior-attachment.test.ts`: replay never deletes prior file
- [ ] 4.8 GREEN: replay branch skips `compensateNewAttachment`

## S4 — Comprobante Timeout and Failure Observability

- [ ] 5.1 RED `ctacte-comprobante.timeout.test.ts`: fake clock +30s owner deadline → `failed`
- [ ] 5.2 GREEN: bound owner/follower wait to 30s; mark `failed`; emit structured `RENDER_TIMEOUT` log and increment `ctacte_comprobante_render_timeout_total`
- [ ] 5.3 RED `ctacte-comprobante.failed-replay.test.ts`: retry of failed job → 504
- [ ] 5.4 GREEN: route returns `504 {error:'RENDER_TIMEOUT',request_id}`
- [ ] 5.5 REFACTOR: centralize `LEASE_DURATION_MS = 30_000`

## Phase 2: S2.c — Route Error Contract (additive; size:exception preserved)

> S2.c review finding: parked candidate's `registerPayment`/`registerDebit` catches (L256-260, L333-336) squash non-`ErrorCode` audit/DB-rollback into 400. Correct: `addNote` L445 / `softDeleteNote` L505 `throw err` → redacted 5xx.

- [x] 2.1 RED `apps/api/src/routes/ctacte-mutations.route-error-contract.test.ts` — mock both fns to throw non-`ErrorCode` (audit/DB-rollback); assert 5xx, NOT 400 `VALIDATION_ERROR`.
- [x] 2.2 GREEN `apps/api/src/routes/ctacte-mutations.ts` — drop 400 fallback for non-`ErrorCode` throws in both catches; `throw err` → redacted 5xx. Preserve CONFLICT/VALIDATION_ERROR/NOT_FOUND/UNSUPPORTED_MEDIA_TYPE.
