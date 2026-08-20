# Design: Padrones Enrollment Lifecycle

## Technical Approach

Add database-enforced lifecycle invariants and explicit create/baja/reactivate commands to Padrones. A focused lifecycle service coordinates conditional writes, durable command receipts, and `@athlos/audit` atomically; the filtered roster gains typed, accessible controls without Socio-detail scope.

## Architecture Decisions

| Option | Tradeoff | Decision and rationale |
|---|---|---|
| Add writes to `padrones/repository.ts` | Fewer files; mixes roster projections with command concurrency | Keep reads there; create `inscription-repository.ts` and `inscription-service.ts` inside the Padrones module, preserving module cohesion and separating rules. |
| Rely on audit dedupe | Cannot replay responses or reject changed payloads | Add `deportes.inscripcion_command_receipts`, unique `(operator_id, caller_key)`, with command, SHA-256 fingerprint, enrollment ID, and result JSON. Centralize the existing CTACTE 1–128-character key/fingerprint convention in `apps/api/src/lib/idempotency.ts`. |
| Lock then update | Serializes losers into false no-ops | Read without locking; target-equal paths revalidate under lock, while changes use CAS and post-read races return `409`. |

## Data Flow

The route validates Zod/RBAC/key and passes `CommandContext { operatorId, sourceIp, callerKey, requestFingerprint }` to the service.

Receipt claim uses `INSERT ... ON CONFLICT DO NOTHING RETURNING` in transaction A. Fingerprint input is `commandType|canonicalEndpoint|canonicalPayload`; equality compares command and fingerprint, preventing cross-endpoint replay. The claimant executes, stores its result, emits audit, then commits. A loser ends A and opens transaction B to `SELECT ... FOR UPDATE` the committed receipt, with bounded retry if invisible. Identical input returns the stored DTO; changed input returns `409`. Winner rollback leaves no receipt, enrollment, or event.

For transitions, first read the enrollment without locking and retain its state/snapshot:
1. If observed equals target, `SELECT ... FOR UPDATE WHERE id AND estado=target`; no match returns `409` without receipt/audit. A match preserves baja metadata and stores `changed:false` before commit, making opposite transitions wait.
2. Otherwise CAS inside transaction A with `WHERE id=? AND estado=(expectedEstado ?? observedState)`. Zero rows means the row was stale or changed after observation: roll back/no audit and return `409`. One returned row supplies the after snapshot; store `changed:true` and emit one audit atomically.

Audit is constructed inside the same transaction from context plus observed/returned rows: server-owned action, `entityType:'inscripcion'`, entity ID, complete before/after snapshots, identity tuple `(socioId, disciplinaId, ejercicioId)` in metadata, source IP, actor, and caller key.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/db/src/schema/deportes.ts`, `packages/db/drizzle/0036_*.sql` | Modify/Create | State/metadata checks, receipt table, backfill. |
| `apps/api/src/lib/idempotency.ts`, `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` | Create/Modify | Shared key/fingerprint primitive; CTACTE delegates without wire-format change. |
| `apps/api/src/modules/padrones/inscription-{repository,service}.ts` | Create | References, receipts, create/CAS/no-op, DTO/error mapping. |
| `apps/api/src/routes/padrones.ts`, `packages/audit/src/emitter.ts` | Modify | Stable routes, ADMIN+OPERADOR, audit actions/context. |
| `apps/api/src/test-standins/db.ts`, `apps/api/src/routes/padrones.test.ts`, `apps/api/src/modules/padrones/inscription-lifecycle.postgres.integration.test.ts` | Modify/Create | Stand-in contracts and PostgreSQL evidence. |
| `apps/web/src/lib/api/padrones.ts`, `apps/web/src/components/padrones/*`, Padrones pages/tests | Modify/Create | Wrappers, modals, separate navigation/actions, feedback/invalidation. |

## Interfaces / Contracts

- `POST /api/v1/padrones/inscripciones`: strict create DTO; initial `activa|pendiente`.
- `POST .../:id/baja`: `{ expectedEstado, motivo, fechaBaja }`; `POST .../:id/reactivar`: `{ expectedEstado }`, target `activa`.
- All mutations require `Idempotency-Key` and `requireRole('ADMIN','OPERADOR')`. Extra immutable fields/key errors → `400`; unknown reference/ID → `404`; duplicate, changed-key payload, or stale changing transition → `409`. CamelCase DTOs include `changed`.

## Testing Strategy

Strict RED-first stand-in/service and `app.inject` tests cover RBAC, strict DTOs, same-state-before-CAS (including stale expected state), repeated-baja metadata, replay/conflict, audit rollback, and concurrent losers. Real PostgreSQL two-connection tests prove receipt visibility/retry, CAS, checks, atomicity, and unique races. Migration tests separately prove known-state case/whitespace normalization, unknown-state abort without partial changes, and deterministic historical-baja backfill. Web Vitest/Testing Library covers stable retry keys, role visibility, modal error announcement/retention, distinct keyboard controls, pending feedback, and invalidating `['padrones', disciplina, ejercicio]` only after `changed:true`.

## Threat Matrix

| Boundary | Applicability | Response / RED tests |
|---|---|---|
| Documentation-like paths | N/A: no execution | None |
| Git repository selection | N/A: no Git | None |
| Commit state | N/A: no VCS | None |
| Push state | N/A: no push | None |
| PR commands | N/A: no PR automation | None |

## Migration / Rollout

Add nullable metadata/receipts; normalize recognized states; abort with anomaly count on unknowns; backfill historical baja with migration date and explicit unavailable-history sentinel. Validate one-way CHECK: `estado <> 'baja' OR (fecha_baja IS NOT NULL AND length(btrim(baja_motivo)) > 0)`. Reactivated/non-baja rows may retain history. Log counts and command outcome/action/IDs, never reason text or caller keys.

Rollback removes UI/routes/services independently but retains additive data; schema corrections are forward-only. Deployment issue #12 and production actions remain excluded.

## Review Work Units

Two PRs are insufficient. Minimum credible chain (authored additions+deletions): (1) migration/schema + migration tests, 260–340; (2) shared idempotency/receipts + PostgreSQL tests, 280–360; (3) lifecycle repository/service/audit + tests, 320–395; (4) Fastify/RBAC/stand-in tests, 260–340; (5) web wrappers/UI/accessibility tests, 340–395. Each includes verification and an independent rollback boundary; split again before apply if forecast reaches 400.

## Open Questions

None.
