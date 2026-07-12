# Exploration: athlos-ctacte-security-reliability-remediation

**Change**: `athlos-ctacte-security-reliability-remediation`
**Date**: 2026-07-12
**Author**: sdd-explore
**Artifact store**: hybrid (OpenSpec + Engram, topic key `sdd/athlos-ctacte-security-reliability-remediation/explore`)
**Anchors**: real 4R anchor review (`athlos-ctacte-mutations-post-apply-v2`, terminal_state=`escalated`) + anchor PR 1 review (terminal_state=`escalated`) — see Engram obs #571, #572.
**Prior lineage status**: `athlos-ctacte-final-verify-remediation` (s1-docs PR #41 landed; PR #42 closed without merge; anchor PR 1 halted at size exception review). User explicitly authorized expanded remediation scope (Engram obs #572) outside the docs/header/DB-evidence budget.

---

## Current State

The `athlos-ctacte-mutations` change is the latest active change (`openspec/changes/athlos-ctacte-mutations/`) with three stacked-to-main slices (A1a, A1b, A2) targeting the `/ctacte/[cuenta]` write surface: registrar pago, registrar débito, reimprimir comprobante (date-range PDF capped at 50), and notas por movimiento. Production-ready code exists for the four routes (`apps/api/src/routes/ctacte-mutations.ts`), the service layer (`apps/api/src/modules/socios/forms/ctacte-mutations.ts`), the comprobante lease/replay state machine (`apps/api/src/modules/socios/forms/ctacte-comprobante.ts`), the notes service (`apps/api/src/modules/socios/ctacte_movement_notes.ts`), and the four migrations (0031 → 0032 → 0033 → 0034). Real 4R review flagged seven deterministic severe contradictions and gaps; the prior anchor lineage (`athlos-ctacte-final-verify-remediation`) was halted because the findings exceeded its 200-line correction budget and only addressed docs/header/DB-evidence.

The verified defects fall into three classes: **implementation** (code disagrees with its own contract or with the canonical Athlos spec), **spec correction** (active delta text no longer reflects the actual durable replay semantics implemented), and **deployment/evidence** (migrations, runbook, and verification gates that block the manual rollout).

| # | Verified defect | Class | Evidence |
|---|---|---|---|
| D1 | `requireAuth()` (no role gate) lets CONSULTA mutate `tesoreria.ctacte`, `socios.ctacte_movement_notes`, and `tesoreria.ctacte_comprobante_retries` — directly contradicts `auth-login/spec.md` §"Role-Based Access Control" where CONSULTA is read-only. | Implementation (security) | `apps/api/src/routes/ctacte-mutations.ts:50` (`const AUTH = { preHandler: requireAuth() }`); all 4 routes share `AUTH`. Active delta `api-design/spec.md:17` says "no role check, no socio-assignment matrix" — that claim is wrong against canonical RBAC. |
| D2 | The audit-logger canonical spec (`openspec/specs/audit-logger/spec.md:114`) locks `bucket_now = floor(Date.now() / 10_000)` as the 10-second idempotency window for `emitAudit`. The ctacte-mutations service uses durable caller-key idempotency (0031, 0032, 0034 unique indexes) AND still emits `CTACTE_*` audits. So a pago replay after 10 s collapses the service-side replay to a no-op BUT creates a NEW audit row — same financial event, two audit rows 11 s apart. `CTACTE_PAYMENT_REGISTERED` rows in `audit_events` no longer correspond 1:1 to financial mutations. | Spec correction + implementation (audit durability) | `packages/audit/src/emitter.ts:101-107` (10 s bucket); `apps/api/src/modules/socios/forms/ctacte-mutations.ts:148-154` (emitPaymentAudit called only on `result.created`); `apps/api/src/modules/socios/ctacte_movement_notes.ts:186-188` (emitNoteAddedAudit only on `result.created`). The `audit-logger/spec.md` delta in `athlos-ctacte-mutations/specs/audit-logger/spec.md` does NOT modify the Idempotency Window requirement. |
| D3 | Migration `0034` exists (`packages/db/drizzle/0034_ctacte_movement_notes_idempotency_key_full_unique.sql`) and `docs/runbook.md:5-15, 278-292` documents the manual `0031 → 0032 → 0033 → 0034` order. BUT the `athlos-ctacte-mutations` proposal/design/specs do not include 0034 in the migration set (proposal.md:11, design.md:89, 90 reference only `0031`). Verification: `grep -l '0034' openspec/changes/athlos-ctacte-mutations/` returns 0 matches. The active specs therefore are silent about 0034 even though `ctacte_movement_notes_repository.ts` and `apps/api/src/modules/socios/forms/ctacte-mutations.ts` depend on the FULL unique index for `ON CONFLICT (idempotency_key) DO NOTHING`. If the chain ships as documented, the `ON CONFLICT` clause throws `there is no unique or exclusion constraint matching the ON CONFLICT specification` and every note POST 5xx's. | Deployment/evidence (runbook integrity) | `packages/db/drizzle/0034_*.sql:38-42`; `packages/db/src/ctacte_movement_notes_repository.ts:88` (`onConflictDoNothing({ target: ctacteMovementNotes.idempotencyKey })`). Runbook references 0034; specs do not. |
| D4 | All four audit emissions swallow failures (`try { emitAudit } catch (err) { console.error }`) — explicit comment "a failure here does NOT roll back the primary write". The canonical `audit-logger/spec.md:11` requires "MUST record all auditable events" and "MUST NOT be updated or deleted after insertion". The conflict is intentional in some flows (the comprobante PDF is already in the caller's hands, you cannot roll back), but for `CTACTE_PAYMENT_REGISTERED` / `CTACTE_DEBIT_REGISTERED` / `CTACTE_MOVEMENT_NOTE_ADDED` losing the audit row silently for a financial mutation is a regulatory hole. Today there is no alarm, no retry queue, no surfaced 5xx, no admin-visible "missed audit" counter — just `console.error`. | Implementation (audit durability) | `apps/api/src/modules/socios/forms/ctacte-mutations.ts:418-420`, `462-464`; `apps/api/src/modules/socios/forms/ctacte-comprobante.ts:359-361`; `apps/api/src/modules/socios/ctacte_movement_notes.ts:303-307`. The verification suite has no test for "audit insert fails → caller sees 5xx". |
| D5 | In `registerPayment`, `uploadAttachment()` runs BEFORE `insertCtacteRow()`. If the ctacte insert fails (unique constraint on `idempotency_key`, deadlock, socio FK error after the socio exists check), the attachment row + file are orphaned: `socios.socio_attachments` row persists with no referencing `tesoreria.ctacte.comprobante_attachment_id`, and the file stays on disk. There is no try/catch/finally compensation. Additionally, the comprobante endpoint does not verify that a caller-key is bound to the operator identity: `comprobanteRequestFingerprint(params)` hashes `socioId|cuenta|from|to` only. Two different operators using the same caller-key + same range collide on the durable comprobante cache; the second operator receives the FIRST operator's PDF and audit (`CTACTE_COMPROBANTE_PRINTED` recorded with the first operator's id). | Implementation (security + reliability) | `apps/api/src/modules/socios/forms/ctacte-mutations.ts:117-141` (no compensation); `apps/api/src/modules/socios/forms/ctacte-comprobante.ts:297-301` (fingerprint excludes operatorId). No tests assert "attachment rolled back when ctacte insert fails" or "cross-operator same-key returns CONFLICT". |
| D6 | Pago route accepts any non-empty `Idempotency-Key` length (only `trim().length === 0` rejected) while debit/notes/comprobante cap at 128 chars. Inconsistent contract for the same header across the same change. The comprobante `cuenta` query param is `z.string().min(1)` — accepts arbitrary garbage; the api-design delta says `cuenta` is a UUID but the implementation does not enforce it. Date validation uses `isValidIsoCalendarDate` which correctly rejects `2026-02-30` / `2026-13-01` (verified at `ctacte-mutations.ts:355-362`); however the `paymentSchema` zod refine runs only on the parsed string AFTER multipart parsing, and the route's `montoStr = fields['monto']` accepts a string up to the multipart limit. No JSON `cuenta` schema validation exists for the note route (notes route uses `idSchema` for movementId; notes are per-movement not per-cuenta so this is fine). | Implementation (input validation) | `apps/api/src/routes/ctacte-mutations.ts:144-147` (pago accepts any length), `:282-292` (debit 128-cap), `:393-402` (notes 128-cap), `:522-528` (comprobante 128-cap), `:72-77` (`cuenta` min(1)). The api-design delta `spec.md:66` lists `cuenta (UUID)`. |
| D7 | Comprobante render path has no observable failure metrics. `store.fail(retryKey, owner)` writes a `failed` lease row but emits nothing to logs/metrics (no `request.log.warn({ event: 'comprobante_render_failed' }, ...)`). The `tesoreria.ctacte_comprobante_retries` table is durable state, but there is no scheduler/admin query that surfaces "N renders failed in the last 24 h" or "X stale leases reclaimed today". No latency or concurrency SLO is documented in the api-design delta: puppeteer `page.pdf()` can take 3-15 s for a 50-movimiento PDF; the existing 3-slot semaphore queues silently; with 50 concurrent comprobante requests the 51st waits indefinitely with no client-side timeout. The golden test asserts cap enforcement but no concurrent-load SLA. | Deployment/evidence (observability + SLO) | `apps/api/src/modules/socios/forms/ctacte-comprobante.ts:127-133` (catch path calls `store.fail` + rethrow); no `request.log` calls. `apps/api/src/modules/socios/forms/pdf-generator.ts:37-43` (cap 3). No spec scenario for "50 concurrent comprobantes → Nth waits N×avg_render_time" or "render fails → admin surface". |

Two adjacent (NON-blocking) findings discovered during exploration that the orchestrator should surface to the user but are NOT release-blocking:

- A. `auth-login/spec.md:188` "CONSULTA must not be able to perform mutations" is the canonical RBAC clause; the `api-design/spec.md:17` ctacte-mutations delta explicitly contradicts it ("no role check"). The delta text is a spec correction, not an implementation gap.
- B. The `notes.ts` service uses `isCanonicalMatch(row, intent)` that compares `(movementId, body, operatorId)` to detect same-key replay — but it does NOT validate that the operator identity in the persisted row matches the request's `request.operator.sub` when the CALLER is not the persisted author. Currently the only caller-side check is `request.operator.sub === params.operatorId` (route layer passes `operatorId: request.operator.sub`). This is fine for v1 (one operator per token), but cross-operator key replay would emit the audit under the WRONG operatorId. Same root cause as D5 (operator not bound to fingerprint).

---

## Affected Areas

### Code (implementation defects — D1, D2 impl-side, D4, D5, D6, D7 impl-side)

- `apps/api/src/routes/ctacte-mutations.ts` — pago Idempotency-Key length check, role gate, comprobante `cuenta` UUID validation, pago compensation hook for orphan attachment.
- `apps/api/src/modules/socios/forms/ctacte-mutations.ts` — `registerPayment` try/catch around `uploadAttachment`+`insertCtacteRow`; `assertMatchingPaymentRetry` should fold operator identity into the canonical-payload comparison (already does via `idempotencyOperatorId`); `emitPaymentAudit`/`emitDebitAudit` need a "missed-audit" escape hatch (rethrow when primary write succeeded AND a separate retry mechanism will not fire).
- `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` — `comprobanteRequestFingerprint` MUST include operator identity; `store.fail` MUST log via `request.log` (or accept a `log` injection); render timeout / heartbeat-stale observability.
- `apps/api/src/modules/socios/ctacte_movement_notes.ts` — `emitNoteAddedAudit` durability (same try/catch pattern as ctacte-mutations).
- `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts` — already correct; no edit unless D2 forces a schema change.
- `packages/audit/src/emitter.ts` — possible extension point for `omitBucket: true` flag that computes idempotency key without the 10-second bucket for caller-key replay events. Currently the bucket is hard-coded.

### Specs (corrections — D2 spec-side, D5 spec-side, D6 spec-side)

- `openspec/changes/athlos-ctacte-mutations/specs/audit-logger/spec.md` — needs `MODIFIED Requirements` §"Idempotency Window" to add a carve-out for the four `CTACTE_*` actions whose service contract is durable caller-key: the 10-second bucket SHALL NOT apply when the caller already supplied an `Idempotency-Key` header (the idempotency key is the SHA-256 of `(operatorId|action|entityId|canonical_json(payload))` with NO bucket). Add a new scenario: "Same CTACTE_PAYMENT_REGISTERED with same Idempotency-Key after 10s produces exactly one audit row."
- `openspec/changes/athlos-ctacte-mutations/specs/api-design/spec.md` — needs `MODIFIED Requirements` §"CTACTE JSON Mutation Endpoints" to add `requireRole('ADMIN','TESORERO','OPERADOR')` (NOT `CONSULTA`) on pago + débito + notas; `requireAuth()` only on comprobante (read-of-pdf). Also tighten `cuenta` validation to `z.string().uuid()` and Idempotency-Key length to 1-128 across ALL FOUR routes.
- `openspec/changes/athlos-ctacte-mutations/proposal.md` line 102 says "idempotency 10s-bucket via `emitAudit` SHA-256 is plumbing-not-policy" — that text is stale and conflicts with the durable service contract. Update to "durable caller-key idempotency at the service layer; audit emission key is `(operatorId|action|entityId|canonical_json(payload))` with NO bucket for the four CTACTE_* actions".

### Migration / deployment / evidence (D3, D7 evidence-side)

- `packages/db/drizzle/` — already contains 0031/0032/0033/0034; no new migration needed unless D2 forces a schema change (it does not).
- `docs/runbook.md` — already documents `0031 → 0032 → 0033 → 0034`; the active specs do not. After this change, `openspec/specs/database-migrations/spec.md` should gain an `ADDED Requirements` scenario pinning the full 4-migration chain under the ctacte-mutations umbrella.
- `openspec/specs/deployment-devops/spec.md` (SLO + observability) — needs a `MODIFIED Requirements` §"Observability" to add a metric `athlos_ctacte_comprobante_render_failures_total` with operator_id and reason labels, and a §"Comprobante Concurrency" scenario: "When N>3 concurrent comprobante requests are in flight, requests N+1..N SHALL queue with a documented max-wait = 30s and SHALL return 504 GATEWAY_TIMEOUT if exceeded; puppeteer pool SHALL remain at semaphore cap 3."

### Tests (TDD evidence)

- `apps/api/src/routes/ctacte-mutations.test.ts` — add CONSULTA → 403 cases for pago + débito + notas; add 128-char-cap to pago; add `cuenta` UUID validation; add operator-bound fingerprint tests for comprobante (operator A replays → operator B with same key gets 409 CONFLICT).
- `apps/api/src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts` — add "attachment orphan compensation" case: stub `insertCtacteRow` to throw → assert `getAttachment` is called on the returned attachment id and the row+file are deleted.
- `apps/api/src/modules/socios/forms/ctacte-comprobante.lease.test.ts` — add "cross-operator same-key" case + "render fail observable" case (assert `store.fail` is called AND a log entry is emitted AND the audit attempt is flagged missed).
- `packages/audit/src/emitter.test.ts` — add "caller-key replay across 10s boundary produces single row" case (requires a way to pass `omitBucket: true` through the emitter).

---

## Approaches

### Approach A — Spec + impl stacked slices (RECOMMENDED, fits 400-line budget)

Five stacked-to-main slices, each ≤ 400 changed lines, no production-code change in slice 1, code changes start at slice 2:

| Slice | Scope | ~LoC | Risk |
|---|---|---|---|
| **S0 — Spec corrections** (docs only) | Update `audit-logger` + `api-design` deltas + `database-migrations` + `deployment-devops` deltas to reflect durable caller-key, role gate, 128-char cap, UUID `cuenta`, observability metrics, SLO. Update `proposal.md` + `design.md` §12 stale text. | 200–280 | None (text only) |
| **S1 — Role gate + input validation** (impl, no DB) | Add `requireRole('ADMIN','TESORERO','OPERADOR')` to pago + débito + notas; leave comprobante on `requireAuth()` per RBAC. Add 128-char cap to pago. Tighten `cuenta` to UUID. New + failing route tests first (RED), impl next (GREEN). | 180–260 | Low; auth gate is a pure additive preHandler |
| **S2 — Audit durability + bucket carve-out** (impl + spec sync) | Extend `packages/audit/src/emitter.ts` with `omitBucket` (or `bucket: 'none'`) flag; add typed wrappers `emitReplayAudit` for the four CTACTE_* actions. Wrap `emitPaymentAudit`/`emitDebitAudit`/`emitNoteAddedAudit` in transactional block with the primary write OR add a "missed audit" admin counter (decision needed). Update `audit-logger` delta to specify the carve-out. | 200–280 | Medium; transactional audit changes the durability guarantee — needs explicit product decision (transactional vs counter) |
| **S3 — Attachment compensation + operator-bound comprobante fingerprint** | `registerPayment` try/catch with rollback hook (`attachmentService.delete(attachmentId)` on ctacte insert failure). `comprobanteRequestFingerprint` includes `operatorId`. Add tests. | 150–220 | Low–Medium; idempotent — second insert still works, just now with proper provenance |
| **S4 — Observability + SLO evidence** | `request.log.warn` on `store.fail` + heartbeat expiry; new metric `athlos_ctacte_comprobante_render_failures_total` (or counter table row); `apps/api/src/routes/admin/ctacte-comprobante-stats.ts` (ADMIN-only) for ops query. Spec delta for `deployment-devops`. | 180–250 | Low; no behaviour change for happy path |

Total: 5 slices × ~220 LoC avg = ~1100 LoC over 5 stacked PRs. Each PR is independently revertible. Each PR has its own TDD cycle. The first PR is doc-only so the contract is locked before any production code lands.

- **Pros**: Smallest per-PR diff; doc-first ordering means slice 1 can be reviewed by a spec author before engineers touch code; explicit decision points (transactional audit vs counter) get surfaced; matches the existing `athlos-ctacte-final-verify-remediation` stacked-to-main pattern; no DB migration needed; no runbook edits needed (0034 already documented).
- **Cons**: Five PRs over ~5 days; review coordination overhead.
- **Effort**: Medium

### Approach B — Single atomic PR with `size:exception` (NOT recommended)

One ~1200 LoC PR covering all 7 defects + spec sync + runbook sync. User previously accepted a 612-line size exception for the atomic spec anchor (`engram #567 — Approve atomic spec size exception`), so precedent exists.

- **Pros**: One review cycle; no chain coordination.
- **Cons**: Five defect classes in one PR makes review 3-4× harder than any single slice; review-burnout risk; harder to revert one defect class without touching others; contradicts `chained-pr` skill guardrail (PR >400 changed lines → must chain or accept exception; this PR would be 3× the budget).
- **Effort**: High

### Approach C — Hybrid: S0 spec + S2 audit + S3 attachment (skip S1+S4 in v1)

Three slices covering the most-severe defects only; defer role gate + observability to follow-up change.

- **Pros**: Fewer PRs; covers the regulatory holes (audit, attachment provenance) first.
- **Cons**: Leaves a security hole (CONSULTA can mutate financial state) unpatched in v1; observability gaps persist; product decision for "transactional vs counter" audit becomes implicit when S2 lands.
- **Effort**: Medium

### Approach D — Auto-merge fix through existing `athlos-ctacte-final-verify-remediation` lineage (NOT recommended)

Resume the halted lineage, add the 5 new slices to its task list.

- **Pros**: No new change folder; reuse existing review transaction.
- **Cons**: Mixes 200-line correction budget (anchor lineage) with 1100-line expanded scope (this change); violates the B1b LESSON #2 "atomic canonical sync" rule by deferring spec corrections across many slices; harder to review.
- **Effort**: High

---

## Recommendation

**Approach A** — five stacked-to-main slices, each ≤ 400 changed lines. The doc-only S0 first, then S1 (role + input validation), S2 (audit durability), S3 (attachment + fingerprint), S4 (observability + SLO). This is the only approach that satisfies:

1. The 400-line `chained-pr` budget per slice without `size:exception`.
2. The B1b LESSON canonical spec sync — S0 lands the contract corrections BEFORE any code PR starts.
3. The user's explicit "expanded remediation" authorization (Engram obs #572) which demanded planning before coding.
4. Strict TDD: each slice writes failing tests first, then impl.
5. Independent revertibility — a S1 regression does not block S2/S3/S4.

Two **explicit product decisions** must be resolved by the user before sdd-propose:

1. **Audit durability strategy (D4): transactional wrap vs "missed audit" counter + 5xx**. Transactional wrap means `emitAudit` is in the same DB transaction as the primary write — if audit fails, the write rolls back (perfect audit trail, may surprise operators who see 5xx for "DB hiccup"). Counter means best-effort + a `ctacte_audit_missed` table + an admin endpoint; audit failures stay observable without rolling back the financial mutation. Both are valid; the canonical `audit-logger/spec.md:11` says "MUST record all auditable events", which leans transactional. **Recommendation: transactional for `CTACTE_PAYMENT_REGISTERED` and `CTACTE_DEBIT_REGISTERED` (financial); counter for `CTACTE_MOVEMENT_NOTE_ADDED` and `CTACTE_COMPROBANTE_PRINTED` (already-failed-write would be confusing).** This split is a product decision, not technical.
2. **Role gate scope (D1)**: which roles can mutate? Current proposal says "any authenticated operator". Canonical RBAC says CONSULTA is read-only. The natural gate is `requireRole('ADMIN','TESORERO','OPERADOR')` for pago + débito + notas (comprobante reprint is read-of-generated-doc, keep `requireAuth()`). **Recommendation: ADMIN+TESORERO+OPERADOR for write; any auth for comprobante reprint.** Same product decision — needs user confirm.

---

## Risks

- **R1 (CRITICAL, blocking): CONSULTA can mutate financial state** (D1). Until S1 lands, a CONSULTA token can register a pago, post a débito, or post a nota. Mitigation: S1 ships FIRST after S0. The pre-PR audit must surface this as a release blocker for any deploy that exposes the ctacte-mutations routes publicly.
- **R2 (CRITICAL, blocking): audit-key / caller-key contradiction creates duplicate audit rows** (D2). Until S2 lands, every pago or débito that retries after 10s produces TWO `CTACTE_*` audit rows. Mitigation: S2 ships before S3 (the durable-key guarantee is part of the corrected contract).
- **R3 (CRITICAL, blocking): orphan comprobante attachments** (D5 first half). Until S3 lands, every ctacte-insert failure leaks a comprobante file + row. Mitigation: S3 ships with explicit compensation tests.
- **R4 (WARNING, blocking if user picks "transactional"): unexpected 5xx from audit failures** (D4). If S2 picks transactional, operators will see 500 errors when audit infra hiccups. Mitigation: clear error envelope; admin counter is advisory; the same DB transaction that succeeded the write succeeds the audit 99.9% of the time.
- **R5 (WARNING): operator-bound comprobante fingerprint** (D5 second half). Until S3 lands, two operators with the same key+range receive each other's PDF + audit. Lower probability than R1–R3 because keys are caller-generated UUIDs, but not zero (dev/test/staging collisions).
- **R6 (WARNING): observability gaps** (D7). Not blocking — the system is correct, just unobservable. S4 can be deferred behind a feature flag if product wants to ship S0–S3 first.
- **R7 (WARNING): inconsistent input validation** (D6). The 128-char cap on three routes but not the fourth is a minor contract inconsistency. S1 fixes it.
- **R8 (MEDIUM): 0034 migration reference drift** (D3). The runbook mentions 0034; the specs do not. If a future doc-only sync forgets to mention 0034, operators following the spec alone will miss the migration. S0 fixes this.

---

## Open Questions (Decision Needed Before Propose)

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Audit durability: transactional wrap OR best-effort + missed-audit counter? | Split: transactional for payment/debit; counter for note/comprobante. |
| Q2 | Role gate on pago + débito + notas: `requireRole('ADMIN','TESORERO','OPERADOR')` OR a custom `requirePermission('can_register_payment')`? | ADMIN/TESORERO/OPERADOR (matches canonical RBAC; no new permission). |
| Q3 | Comprobante reprint role: keep `requireAuth()` (any operator) or gate to ADMIN/TESORERO/OPERADOR? | Keep `requireAuth()` (PDF is read-of-generated-doc; auth-only is fine). |
| Q4 | SLO: what is the max comprobante render wait? Currently unbounded. | 30 s. After 30 s the lease is treated as `failed` and a retry returns 504 GATEWAY_TIMEOUT. |
| Q5 | Comprobante concurrency cap: keep 3 (semaphore) or raise? | Keep 3 — raising requires puppeteer pool growth which is out of scope. |
| Q6 | Should the `audit-logger` bucket carve-out be a new action class (`emitReplayAudit`) or an option flag on `emitAudit`? | New typed wrapper `emitCallerKeyAudit(db, record)` so the bucket omission is impossible to forget at call sites. |
| Q7 | Should we add a new spec section to `api-design` for "Caller-Key Idempotency Contract" or fold into existing? | New section; it cuts across all four routes. |
| Q8 | Should S0/S1 block each other (serial stacked) or merge into one spec+impl PR? | Stacked — S0 is text-only and lands first; the spec gate must be reviewed before any code lands. |

---

## Ready for Proposal

**Conditional on user answers to Q1, Q2, Q3, Q4 (Q5–Q8 have safe defaults and the orchestrator may proceed with defaults).** If the user accepts defaults, the next phase is `sdd-propose` with five stacked slices, S0 first.

If the user prefers Approach C (hybrid: S0 + S2 + S3 only), the proposal is also ready — but with the explicit caveat that R1 (CONSULTA can mutate) remains unaddressed and the orchestrator must surface this risk to the user before approving.

If the user prefers Approach B (atomic `size:exception`), the proposal is NOT ready — the chained-pr guardrail requires explicit `size:exception` accept and the orchestrator must surface "3× the budget" before doing so.

The proposal MUST also include the roll-back plan per `chained-pr` skill (each slice is independently revertible; S0 is text-only so revert is a no-op; S1 revert removes the role gate but tests will fail because CONSULTA cannot mutate under the spec; S2 revert is a behavioral regression to the duplicate-audit bug; S3 revert reintroduces the orphan-attachment hole).

---

## Artifact Persistence

- OpenSpec: `openspec/changes/athlos-ctacte-security-reliability-remediation/exploration.md` (this file).
- Engram: topic key `sdd/athlos-ctacte-security-reliability-remediation/explore`, type `architecture`, capture_prompt `false`.