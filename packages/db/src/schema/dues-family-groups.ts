import { sql } from 'drizzle-orm'
import { check, date, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'
import { socios } from './socios.ts'
import { tesoreriaSchema } from './tesoreria.ts'

export const duesFamilyGroups = tesoreriaSchema.table(
  'dues_family_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    authorizationEvidence: jsonb('authorization_evidence').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reasonCheck: check('dues_family_groups_reason_check', sql`btrim(${table.reason}) <> ''`),
  }),
)

export const duesFamilyMemberships = tesoreriaSchema.table(
  'dues_family_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyGroupId: uuid('family_group_id')
      .notNull()
      .references(() => duesFamilyGroups.id, { onDelete: 'restrict' }),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    authorizationEvidence: jsonb('authorization_evidence').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => operators.id, { onDelete: 'restrict' }),
    revokeReason: text('revoke_reason'),
  },
  (table) => ({
    lookupIdx: index('dues_family_memberships_lookup_idx').on(table.socioId, table.effectiveFrom),
    intervalCheck: check(
      'dues_family_memberships_interval_check',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    reasonCheck: check('dues_family_memberships_reason_check', sql`btrim(${table.reason}) <> ''`),
    revokeCheck: check(
      'dues_family_memberships_revoke_check',
      sql`(${table.revokedAt} IS NULL AND ${table.revokedBy} IS NULL AND ${table.revokeReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedBy} IS NOT NULL AND ${table.revokeReason} IS NOT NULL AND btrim(${table.revokeReason}) <> '')`,
    ),
  }),
)

export type DuesFamilyGroup = typeof duesFamilyGroups.$inferSelect
export type NewDuesFamilyGroup = typeof duesFamilyGroups.$inferInsert
export type DuesFamilyMembership = typeof duesFamilyMemberships.$inferSelect
export type NewDuesFamilyMembership = typeof duesFamilyMemberships.$inferInsert
