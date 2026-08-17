import { sql } from 'drizzle-orm'
// prettier-ignore
import { check, char, date, index, integer, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'
import { socios } from './socios.ts'
import { duesFamilyGroups } from './dues-family-groups.ts'
import { tesoreriaSchema } from './tesoreria.ts'

// prettier-ignore
export const duesBenefitKind = tesoreriaSchema.enum('dues_benefit_kind', ['FIXED_DISCOUNT', 'PERCENT_DISCOUNT', 'SCHOLARSHIP'])
// prettier-ignore
export const duesBenefitCombinability = tesoreriaSchema.enum('dues_benefit_combinability', ['COMBINABLE', 'EXCLUSIVE'])
// prettier-ignore
export const duesBenefitPercentageBasis = tesoreriaSchema.enum('dues_benefit_percentage_basis', ['GROSS', 'REMAINING'])

// prettier-ignore
export const duesBenefitRules = tesoreriaSchema.table('dues_benefit_rules', {
  id: uuid('id').primaryKey().defaultRandom(), kind: duesBenefitKind('kind').notNull(),
  socioId: uuid('socio_id').references(() => socios.id, { onDelete: 'restrict' }), familyGroupId: uuid('family_group_id').references(() => duesFamilyGroups.id, { onDelete: 'restrict' }),
  amount: numeric('amount', { precision: 14, scale: 2 }), percentage: numeric('percentage', { precision: 5, scale: 2 }), currency: char('currency', { length: 3 }),
  effectiveFrom: date('effective_from').notNull(), effectiveTo: date('effective_to'), priority: integer('priority').notNull(),
  combinability: duesBenefitCombinability('combinability').notNull(), exclusiveGroup: text('exclusive_group'), percentageBasis: duesBenefitPercentageBasis('percentage_basis'),
  reason: text('reason').notNull(), authorizationEvidence: jsonb('authorization_evidence').notNull().default({}),
  createdBy: uuid('created_by').notNull().references(() => operators.id, { onDelete: 'restrict' }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }), revokedBy: uuid('revoked_by').references(() => operators.id, { onDelete: 'restrict' }), revokeReason: text('revoke_reason'),
}, (table) => ({
  targetCheck: check('dues_benefit_rules_target_check', sql`((${table.socioId} IS NOT NULL)::int + (${table.familyGroupId} IS NOT NULL)::int) >= 1`),
  valueCheck: check('dues_benefit_rules_value_check', sql`((kind = 'FIXED_DISCOUNT' AND amount > 0 AND percentage IS NULL AND currency IS NOT NULL AND percentage_basis IS NULL) OR (kind IN ('PERCENT_DISCOUNT', 'SCHOLARSHIP') AND amount IS NULL AND percentage > 0 AND percentage <= 100 AND currency IS NULL AND percentage_basis IS NOT NULL))`),
  intervalCheck: check('dues_benefit_rules_interval_check', sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`), priorityCheck: check('dues_benefit_rules_priority_check', sql`${table.priority} >= 0`),
  combinabilityCheck: check('dues_benefit_rules_combinability_check', sql`(combinability = 'COMBINABLE' AND exclusive_group IS NULL) OR (combinability = 'EXCLUSIVE' AND exclusive_group IS NOT NULL AND btrim(exclusive_group) <> '')`),
  reasonCheck: check('dues_benefit_rules_reason_check', sql`btrim(${table.reason}) <> ''`), revokeCheck: check('dues_benefit_rules_revoke_check', sql`(${table.revokedAt} IS NULL AND ${table.revokedBy} IS NULL AND ${table.revokeReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedBy} IS NOT NULL AND ${table.revokeReason} IS NOT NULL AND btrim(${table.revokeReason}) <> '')`),
  effectiveIdx: index('dues_benefit_rules_effective_idx').on(table.priority, table.effectiveFrom),
}))

export type DuesBenefitRule = typeof duesBenefitRules.$inferSelect
export type NewDuesBenefitRule = typeof duesBenefitRules.$inferInsert
