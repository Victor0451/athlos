/**
 * @athlos/audit — operator event audit trail.
 *
 * Provides:
 *   - auditPlugin — Fastify plugin (fp-wrapped) capturing operator mutations
 *   - emitAudit   — idempotent SHA-256 10s-bucket deduplication
 *   - queryAudit  — paginated read with operator/entity/from/to filters
 *
 * TWO-WRITE-PATH ARCHITECTURE (design §5):
 *
 *   HTTP request ──► authPlugin ──► request.operator
 *                              │
 *                              ▼
 *                        auditPlugin ──► onResponse ──► emitAudit(db, record)
 *                        (fp-wrapped)        │              (operator_id set)
 *                                           ▼
 *                                    audit_events  (one row per operator event)
 *                                           ▲
 *   drift cron ──► emitDriftAlert()  ──────┤  (operator_id = NULL, direct insert)
 *   scheduled-import ─► post-import ──────┤  (system events, no idempotency key)
 *
 * The middleware path is for OPERATOR events (human-initiated HTTP calls).
 * The direct-insert path is for SYSTEM events (jobs, cron triggers).
 */
export { auditPlugin } from './middleware.ts'
export { emitAudit, AuditAction } from './emitter.ts'
export { queryAudit } from './query.ts'
export type { AuditRecord, SocioAttachmentAuditAction } from './emitter.ts'
export type { AuditQueryFilters, AuditPage } from './query.ts'
