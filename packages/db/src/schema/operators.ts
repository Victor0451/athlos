import {
  boolean,
  char,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * `operators` — Athlos staff accounts.
 *
 * Replaces the legacy USUARIO.DBF table. The `role` column uses a
 * single-char code (`A`dmin, `T`esorero, `O`perador, `C`onsulta) to
 * keep the column narrow; the auth API maps char → human string on
 * read so the JWT carries the readable role name.
 *
 * Lockout state is denormalised on the row (failed_login_attempts,
 * locked_until) so a 5-attempts-in-15-min check is one query, not a
 * join to a separate attempts log. The window is computed at query
 * time — see the auth-login spec §"Login Attempt Lockout".
 */
export const operators = pgTable('operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  /** Single-char role code: A=ADMIN, T=TESORERO, O=OPERADOR, C=CONSULTA. */
  role: char('role', { length: 1 }).notNull(),
  canReprint: boolean('can_reprint').notNull().default(false),
  canAnulate: boolean('can_anulate').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * `refresh_tokens` — opaque session tokens, stored as SHA-256 hash.
 *
 * The raw token is shown to the client ONCE (in the login response)
 * and never again. On refresh the row is looked up by hash, validated
 * (not revoked, not expired), and a new pair is issued. On logout the
 * `revoked_at` timestamp is set; a subsequent refresh attempt with
 * the same token fails the `revoked_at IS NULL` check.
 *
 * Index on `token_hash` so the lookup is O(log n). The
 * `(operator_id)` index is for the "revoke all sessions for operator"
 * admin operation (PR 3b).
 */
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => operators.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Operator = typeof operators.$inferSelect
export type NewOperator = typeof operators.$inferInsert
export type RefreshToken = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert
