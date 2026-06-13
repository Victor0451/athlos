import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * `public` schema — cross-cutting concerns shared by every domain.
 *
 * Holds:
 *  - `audit_events`     — append-only security/business event log (PR 7a)
 *  - `app_settings`     — key-value runtime config (PR 4 / PR 7a)
 *
 * Reference tables that used to live here (e.g. `operators`,
 * `refresh_tokens`, `job_runs`, `failed_jobs`) are intentionally deferred to
 * the PRs that introduce them. The audit-logger + auth-login + scheduler
 * designs each own their `public.*` tables and add them as Drizzle schema
 * files under `schema/`.
 *
 * NOTE: Drizzle forbids declaring a `pgSchema('public')` constant because
 * the `public` namespace is implicit. Tables declared with `pgTable()` land
 * in `public.*` by default, which is what we want. The other four domain
 * schemas (socios, contabilidad, tesoreria, deportes) are real PG schemas
 * and use `pgSchema()` to namespace their tables.
 */

/**
 * Append-only event log. Writes go through `packages/audit` and are
 * de-duplicated by `idempotency_key` (sha256 of operator + action + entity +
 * payload + 10s window). Reads are forward-only — no UPDATE/DELETE from app
 * code. The `REVOKE UPDATE, DELETE` policy ships as a follow-up migration
 * in PR 7a when the audit middleware lands.
 */
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Operator who triggered the event. NULL for system-generated events. */
  operatorId: uuid('operator_id'),
  /** Short verb-noun code, e.g. `AUTH_LOGIN`, `SOCIO_UPDATED`, `JOB_FAILED`. */
  action: text('action').notNull(),
  /** Domain entity class, e.g. `socio`, `asiento`, `operator`. */
  entityType: text('entity_type').notNull(),
  /** PK of the target entity, or an external key (e.g. attempted username). */
  entityId: text('entity_id').notNull(),
  /** Snapshot before the change. NULL for create / non-row actions. */
  oldValue: jsonb('old_value'),
  /** Snapshot after the change. NULL for delete / non-row actions. */
  newValue: jsonb('new_value'),
  /** Client IP extracted from the request. NULL for jobs. */
  sourceIp: text('source_ip'),
  /** Free-form key-value bag (e.g. error code, channel, reason). */
  metadata: jsonb('metadata'),
  /**
   * sha256(operator_id + action + entity_id + payload + 10s_window). NULL
   * for events that don't participate in dedup (system jobs, login failures).
   * Uniqueness is enforced by a partial index in a follow-up migration.
   */
  idempotencyKey: text('idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Key-value runtime configuration. The `key` is stable across deploys;
 * `value` is a JSON document whose shape is keyed by convention (e.g.
 * `key='notifications.email'` → `{host, port, from}`). Reads go through
 * `getAppSetting(db, key)` (added in PR 4 alongside the env loader).
 */
export const appSettings = pgTable('app_settings', {
  /** Dotted key, e.g. `notifications.email`, `import.batchSize`. */
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AuditEvent = typeof auditEvents.$inferSelect
export type NewAuditEvent = typeof auditEvents.$inferInsert
export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert
