import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * `public` schema — cross-cutting concerns shared by every domain.
 *
 * Holds:
 *  - `audit_events`     — append-only security/business event log (PR 7a)
 *  - `app_settings`     — key-value runtime config (PR 4 / PR 7a)
 *  - `notifications`    — in-app notification outbox (PR 6b)
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

/**
 * `notifications` — in-app notification outbox (PR 6b).
 *
 * One row per (event, recipient) channel attempt. The dispatcher
 * (packages/notifications) writes here for the `in_app` channel and
 * for the audit log of every channel attempt (success, failure,
 * skip). The `event_id` column carries the idempotency key from
 * the dispatcher (e.g. `<job_run_id>:<domain>` for drift alerts);
 * multiple in-app rows may share the same `event_id` (one per
 * recipient). The dispatcher dedups at the event level via a
 * `SELECT 1 FROM notifications WHERE event_id = $1 LIMIT 1`
 * lookup — the index is non-unique.
 *
 * `recipient_id` is nullable because some channels (e.g. the
 * approval-link WhatsApp blast) target an external phone number or
 * email address that has no operator row.
 *
 * `metadata` is the free-form JSONB blob the dispatcher stores
 * alongside the row — used for the GET /api/v1/notifications
 * response and for the "drift count" rendering in the UI.
 *
 * `status` follows the standard dispatch lifecycle:
 *   `pending` → `sent` (delivered to the channel)
 *              → `failed` (channel error; written to audit too)
 *   For `in_app` rows, `sent` is set on INSERT (the DB is the
 *   delivery); the value exists to keep the shape uniform with the
 *   email/whatsapp channels.
 *   `read` is set later by the PATCH /api/v1/notifications/:id/read
 *   route.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'email' | 'in_app' | 'whatsapp'. Stored as text to keep the
     *  schema migration cheap; the `NotificationChannel` type in
     *  @athlos/notifications is the runtime gate. */
    channel: text('channel').notNull(),
    /** Operator recipient (FK relaxed for the external-approver
     *  case; the in-app API route filters on this column). */
    recipientId: uuid('recipient_id'),
    /** External address (email, phone) when the recipient is not an
     *  operator row (e.g. whatsapp approval links). */
    recipientAddress: text('recipient_address'),
    /** Short subject for email/whatsapp; null for in-app (we render
     *  the body only). */
    subject: text('subject'),
    body: text('body').notNull(),
    /** Dispatcher context — drift count, approval link id, etc. */
    metadata: jsonb('metadata').notNull().default({}),
    /** Idempotency key supplied by the caller. Unique when present. */
    eventId: text('event_id'),
    /** 'pending' | 'sent' | 'failed' | 'read'. */
    status: text('status').notNull().default('pending'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** For the operator's notification list (recent first). */
    operatorCreatedIdx: index('idx_notifications_recipient_created').on(
      table.recipientId,
      table.createdAt,
    ),
    /**
     * Idempotency index. A non-unique B-tree on
     * `event_id` — the dispatcher does a SELECT-1 check via
     * this index to detect duplicates. We intentionally do NOT
     * add a unique constraint: a single event fans out to
     * multiple in-app rows (one per recipient), and the
     * `event_id` value is intentionally shared across them.
     * The dedup contract is enforced in the dispatcher
     * (`isDuplicate` lookup), not at the DB level — the
     * design's idempotency layer is at the event level, not
     * the row level.
     */
    eventIdIdx: index('idx_notifications_event_id').on(table.eventId),
  }),
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
export type NotificationStatus = Notification['status']
export type NotificationChannelDb = Notification['channel']
