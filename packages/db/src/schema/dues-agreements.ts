import { sql } from 'drizzle-orm'
import {
  check,
  char,
  date,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'
import { socios } from './socios.ts'
import { duesObligations } from './dues.ts'
import { duesSettlements } from './dues-settlements.ts'
import { tesoreriaSchema } from './tesoreria.ts'

// prettier-ignore
export const duesAgreementKind = tesoreriaSchema.enum('dues_agreement_kind', [
  'SIMPLE',
  'INSTALLMENT',
  'NEGOTIATED',
])
// prettier-ignore
export const duesAgreementStatus = tesoreriaSchema.enum('dues_agreement_status', ['ACTIVE', 'FULFILLED', 'CANCELLED', 'SUPERSEDED'])
// prettier-ignore
export const duesAgreements = tesoreriaSchema.table('dues_agreements', {
  id: uuid('id').primaryKey().defaultRandom(), socioId: uuid('socio_id').notNull().references(() => socios.id, { onDelete: 'restrict' }), obligationId: uuid('obligation_id').notNull().references(() => duesObligations.id, { onDelete: 'restrict' }), kind: duesAgreementKind('kind').notNull(), status: duesAgreementStatus('status').notNull().default('ACTIVE'), revisionNumber: integer('revision_number').notNull().default(1), termsVersion: integer('terms_version').notNull().default(0), terms: jsonb('terms').notNull(), reason: text('reason').notNull(), revisionOfAgreementId: uuid('revision_of_agreement_id').references((): AnyPgColumn => duesAgreements.id, { onDelete: 'restrict' }), revisionReason: text('revision_reason'), operatorId: uuid('operator_id').notNull().references(() => operators.id, { onDelete: 'restrict' }), authorizationEvidence: jsonb('authorization_evidence').notNull().default({}), callerKey: text('caller_key').notNull(), requestFingerprint: char('request_fingerprint', { length: 64 }).notNull(), agreementDate: date('agreement_date').notNull().defaultNow(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ key: uniqueIndex('dues_agreements_operator_caller_key_unique').on(table.operatorId, table.callerKey), activeObligation: uniqueIndex('dues_agreements_active_obligation_unique').on(table.obligationId).where(sql`${table.status} = 'ACTIVE'`), reason: check('dues_agreements_reason_check', sql`btrim(${table.reason}) <> ''`), termsVersion: check('dues_agreements_terms_version_check', sql`${table.termsVersion} >= 0`), revisionNumber: check('dues_agreements_revision_number_check', sql`${table.revisionNumber} > 0`), revision: check('dues_agreements_revision_check', sql`(${table.revisionOfAgreementId} IS NULL AND ${table.revisionReason} IS NULL AND ${table.revisionNumber} = 1) OR (${table.revisionOfAgreementId} IS NOT NULL AND ${table.revisionReason} IS NOT NULL AND btrim(${table.revisionReason}) <> '' AND ${table.revisionNumber} > 1)`), fingerprint: check('dues_agreements_fingerprint_check', sql`length(btrim(${table.requestFingerprint})) = 64`) }))

// prettier-ignore
export const duesCommunityWork = tesoreriaSchema.table('dues_community_work', {
  id: uuid('id').primaryKey().defaultRandom(), socioId: uuid('socio_id').notNull().references(() => socios.id, { onDelete: 'restrict' }), obligationId: uuid('obligation_id').notNull().references(() => duesObligations.id, { onDelete: 'restrict' }), agreementId: uuid('agreement_id').references(() => duesAgreements.id, { onDelete: 'restrict' }), settlementId: uuid('settlement_id').notNull().unique().references(() => duesSettlements.id, { onDelete: 'restrict' }), amount: numeric('amount', { precision: 14, scale: 2 }).notNull(), evidence: jsonb('evidence').notNull(), approvalReason: text('approval_reason').notNull(), operatorId: uuid('operator_id').notNull().references(() => operators.id, { onDelete: 'restrict' }), authorizationEvidence: jsonb('authorization_evidence').notNull().default({}), callerKey: text('caller_key').notNull(), requestFingerprint: char('request_fingerprint', { length: 64 }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ amount: check('dues_community_work_amount_check', sql`${table.amount} > 0`), reason: check('dues_community_work_reason_check', sql`btrim(${table.approvalReason}) <> ''`), fingerprint: check('dues_community_work_fingerprint_check', sql`length(btrim(${table.requestFingerprint})) = 64`) }))

export type DuesAgreement = typeof duesAgreements.$inferSelect
export type NewDuesAgreement = typeof duesAgreements.$inferInsert
export type DuesCommunityWork = typeof duesCommunityWork.$inferSelect
export type NewDuesCommunityWork = typeof duesCommunityWork.$inferInsert
