# Design: Athlos CTACTE Security and Reliability Remediation

## Technical Approach

Harden the existing Fastify → service → Drizzle flow without new migrations. Authorization and normalized Zod errors stay at the route boundary; payment, debit, and note creation move their primary insert plus audit insert into one PostgreSQL transaction. Durable operation keys drive both replay and audit identity. Comprobante replay retains migration 0033's state machine but binds ownership to the actor and imposes a 30-second request deadline. Existing 0031–0034 PostgreSQL tests provide rollout evidence.

## Architecture Decisions

| Option | Tradeoff | Decision and rationale |
|---|---|---|
| Best-effort audit vs transaction | Audit failure can reject a financial write | Use `db.transaction`; pass `tx` to repository and `emitAudit`. Commit exactly one mutation and matching audit, or neither. This is the required financial invariant. |
| Time bucket vs caller key | Caller keys require explicit propagation | For covered CTACTE events, hash actor + action + entity + caller `Idempotency-Key`, without time. The audit unique index resolves races; same-key canonical replay emits no second event, while changed payload remains `409`. Non-CTACTE emitters retain current behavior. |
| Global authentication vs explicit gates | More route declarations | Apply `requireRole('ADMIN','TESORERO','OPERADOR')` to payment, debit, note POST/DELETE and `requirePermission('can_reprint')` to PDF. `CONSULTA` remains read-only; middleware returns the established `403 INSUFFICIENT_PERMISSIONS`. |
| Filesystem inside DB transaction vs compensation | Filesystem cannot join PostgreSQL | Upload first, then transactionally create movement/audit. On conflict, DB, or audit failure, hard-delete only the newly created attachment row and unlink its path. Persisted `socioId`, `uploadedBy`, category, SHA-256, and movement FK prove provenance; replay must match all axes and never delete a prior attachment. |
| Heartbeat-only lease vs bounded actor lease | Deadline may discard slow work | Include `operatorId` in the request fingerprint and persisted ownership check. Bound owner and follower wait to 30s; owner-conditional failure marks `failed`, logs `{ event: 'ctacte_comprobante_render_failed', error_code: 'RENDER_TIMEOUT', request_id, actor_id }`, increments `ctacte_comprobante_render_timeout_total`, and returns `504 { error: 'RENDER_TIMEOUT' }`. Same actor/key/payload replays stored bytes; another actor or payload gets `409`. |

## Data Flow

    JWT gate → validate → canonical replay lookup → [DB transaction: mutation + audit] → response
                                      │
    payment file → attachment row/file┴─ failure → row hard-delete + unlink

    can_reprint → actor-bound lease → render (≤30s) → durable result → replay PDF
                                      └─ timeout/failure → failed state + 504/5xx

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/routes/ctacte-mutations.ts` | Modify | Role/permission gates, shared key/date/body validation, 403/504 envelopes. |
| `apps/api/src/modules/socios/forms/ctacte-mutations.ts` | Modify | Atomic payment/debit audit and attachment compensation/provenance. |
| `apps/api/src/modules/socios/ctacte_movement_notes.ts` | Modify | Atomic note insert/audit and caller-key propagation. |
| `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts` | Modify | Transaction-compatible conflict-aware insert. |
| `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` | Modify | Actor fingerprint, 30s deadline, failed-state and replay semantics. |
| `apps/api/src/modules/socios/attachments.ts` | Modify | Narrow compensation primitive for newly created attachments. |
| `packages/audit/src/emitter.ts` | Modify | Optional durable caller-key mode, preserving legacy callers. |
| Existing colocated route/service/audit/PostgreSQL tests | Modify | Focused RED coverage per slice. |
| `openspec/specs/{audit-logger,api-design,auth-login,database-migrations,socio-attachments,monitoring-observability}/spec.md` | Modify | Correct capability contracts and 0034 evidence. |

## Interfaces / Contracts

`emitAudit(dbOrTx, record, { callerKey })` deterministically deduplicates covered events. All idempotency headers are trimmed, 1–128 characters; dates are real `YYYY-MM-DD`, ranges ordered, money finite and positive, and strings trimmed/non-empty. Unexpected persistence/render failures propagate as redacted 5xx; only the 30s deadline maps to 504.

## Testing Strategy and Stacked Rollout

| Slice (≤400 changed lines) | Focused RED tests | Rollback |
|---|---|---|
| S0 contracts | Six spec deltas and 0034 order/evidence | Revert docs only |
| S1 auth/validation | Fastify inject role, permission, malformed/blank/boundary cases | Revert gates/schemas |
| S2 atomic audit/key | PostgreSQL rollback-on-audit-failure, delayed/concurrent replay, conflict | Revert service/emitter together |
| S3 attachment/replay | Orphan cleanup, prior-file preservation, provenance, cross-actor conflict | Revert compensation/actor binding |
| S4 timeout/observability | Fake-clock 30s owner/follower timeout, failed reclaim, 504 | Revert deadline/telemetry |

Integration verification runs the isolated `0031 → 0032 → 0033 → 0034` sequence twice and asserts 0034's full unique index has no predicate. No E2E runner exists. Each slice is independently reviewable, stacked to `main`, and must remain ≤400 authored changed lines including its tests.

## Threat Matrix

Routing/process integration applies, but the reference matrix's five VCS/executable boundaries are all **N/A**: no documentation-path classification, repository selection, commit state, push state, or PR command execution is changed. PDF process safety is covered by S4's bounded timeout/failure RED tests.

## Migration / Rollout

No new migration. Before API rollout, require backup evidence, ordered single-transaction application with `ON_ERROR_STOP`, and catalog evidence for 0033 columns/check/index plus 0034's unconditional unique index. Stop rollout on any missing receipt; 0034 remains forward-only during code rollback. This design performs no deployment or production action.

## Open Questions

None.
