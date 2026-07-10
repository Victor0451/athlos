# Apply Progress — athlos-ctacte-mutations R2 corrective re-run

**Mode**: Strict TDD  
**Scope**: R2 durable note-audit and comprobante retry correction only  
**Branch**: `fix/ctacte-mutations-r2`

## Cumulative Completed Tasks

- [x] R1.1 — Use the Argentina business calendar for payment future-date validation.
- [x] R1.2 — Validate payment and debit ISO calendar dates with field-level details.
- [x] R1.3 — Fetch up to 51 comprobante movements in one query to detect the cap without a count/fetch race.
- [x] R2 — Apply a stable 10-second retry identity to debit, notes, and comprobante generation; repeated debit/note/PDF requests produce one effect in the bucket, distinct note bodies remain distinct, and debit creates a new row after 10 seconds.
- [x] R2 — Reject note writes when the movement does not belong to `:socioId`, with no note or audit side effect.
- [x] R2 corrective — Use shared audit idempotency for deterministic note retries; no direct loser-path audit insert remains.
- [x] R2 corrective — Persist comprobante bucket results in `tesoreria.ctacte_comprobante_retries`; no process-local PDF cache remains.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| R1.1 Argentina business date | `apps/api/src/modules/socios/forms/ctacte-mutations.getMovements.test.ts` | Unit | ✅ API baseline: 519 passed, 4 skipped | ✅ Boundary assertions written first; missing export failed | ✅ 5/5 passed | ✅ UTC before/after Argentina midnight | ➖ None needed |
| R1.2 ISO calendar validation | `apps/api/src/routes/ctacte-mutations.test.ts` | Integration | ✅ API baseline: 519 passed, 4 skipped | ✅ Tests written first; initial combined RED run was invalidated by fake-timer contamination and corrected before GREEN | ✅ 31/31 passed | ✅ Payment + debit; impossible, malformed, and non-date values | ➖ None needed |
| R1.3 Comprobante cap snapshot | `apps/api/src/modules/socios/forms/ctacte-mutations.getMovements.test.ts` | Unit | ✅ API baseline: 519 passed, 4 skipped | ✅ 51-row interleaving test failed by returning a truncated result | ✅ 5/5 passed | ✅ Normal two-row and capped 51-row snapshots | ➖ None needed |
| R2 idempotency contract | `apps/api/src/routes/ctacte-mutations.test.ts` | Integration | ✅ API baseline: 528 passed, 4 skipped | ✅ Tests written first; initial run had four failures. Debit's first fake-timer attempt timed out, then was corrected to a `Date.now` spy while preserving the scenario. | ✅ 35/35 route tests passed | ✅ Same-bucket debit/note/PDF retries, post-bucket debit, and distinct note bodies | ➖ None needed |
| R2 note ownership | `apps/api/src/routes/ctacte-mutations.test.ts` | Integration | ✅ API baseline: 528 passed, 4 skipped | ✅ Cross-socio POST test written first and returned 201 | ✅ 35/35 route tests passed | ✅ Confirms 404 plus zero note and audit side effects | ➖ None needed |
| R2 corrective: durable comprobante replay | `apps/api/src/modules/socios/forms/ctacte-comprobante.golden.test.ts` | Unit | ✅ Existing targeted tests were green before the test change | ✅ Actual RED: command failed because `generate` was called 2 times | ✅ Same command passed: 3/3 | ✅ Concurrent identical retry plus normal and not-found paths | ➖ None needed |
| R2 corrective: note audit persistence | `apps/api/src/routes/ctacte-mutations.test.ts`, `apps/api/src/modules/socios/ctacte_movement_notes.test.ts` | Integration + Unit | ✅ Targeted route baseline: 36/36 | ⚠️ No valid RED command captured: the initial route-level concurrent assertion passed because Fastify injection serialized the handler. No RED evidence is fabricated. | ✅ Route 36/36; service 4/4 | ✅ Same body versus distinct body; concurrent route assertion | ➖ None needed |
| R2a comprobante slow replay | `apps/api/src/modules/socios/forms/ctacte-comprobante.golden.test.ts` | Unit | ✅ 3/3 before change | ✅ `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-comprobante.golden.test.ts` exited 1: `Comprobante generation is still in progress` after 500ms | ✅ same command exited 0: 4/4 | ✅ 550ms owner render, exact non-zero movementCount replay | ➖ None needed |
| R2a debit opaque key | API/service/web debit targets | Unit + Component | ✅ debit 3/3; web client 9/9; form 7/7 | ✅ targeted service/client/form RED exits 1: content-derived key or missing header/key forwarding | ✅ service 4/4; web client 9/9; form 7/7 | ✅ same-key replay and client-generated key | ➖ None needed |

## Test Summary

- `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-mutations.getMovements.test.ts` — passed (5 tests).
- `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` — passed (35 tests; runner expanded to the API package suite: 532 passed, 4 skipped).
- `pnpm --filter @athlos/api typecheck` — passed.
- `pnpm --filter @athlos/api lint` — passed with one existing unrelated `no-console` warning in `src/routes/admin/gastos.test.ts:367`.
- `pnpm --filter @athlos/api test:run src/modules/socios/forms/ctacte-comprobante.golden.test.ts` — actual RED (one failure), then GREEN (3 passed).
- `pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes.test.ts` — passed (4 tests).
- `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` — passed (36 tests).
- `pnpm --filter @athlos/api typecheck` — passed.
- `pnpm --filter @athlos/db typecheck` — passed.
- No full suite run; targeted tests ran sequentially.
- PostgreSQL double-apply and production rollout validation remain intentionally unrun in this R2a slice.

## Remaining Remediation

- [ ] R3 — Production note workflow, deletion, and cuenta state.
- [ ] R3 — Per-cuenta collapsed state.
- [ ] R4 — Field-level ApiError mapping.
- [ ] R5 — Evidence reconciliation.
