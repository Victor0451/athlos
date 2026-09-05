import { sql } from 'drizzle-orm'
// prettier-ignore
import { check, char, date, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'
import { approvalTokens } from './approval-tokens.ts'
import { disciplinas, inscripciones } from './deportes.ts'
import { socios } from './socios.ts'
import { tesoreriaSchema } from './tesoreria.ts'

// prettier-ignore
export const duesPriceKind = tesoreriaSchema.enum('dues_price_kind', ['BASE', 'SPORT'])
// prettier-ignore
export const duesAssessmentRule = tesoreriaSchema.enum('dues_assessment_rule', ['FULL_MONTH', 'DAILY_PRORATED', 'NEXT_PERIOD'])
// prettier-ignore
export const duesObligationKind = tesoreriaSchema.enum('dues_obligation_kind', ['MONTHLY_DUES', 'COMPENSATION'])
// prettier-ignore
export const duesComponentKind = tesoreriaSchema.enum('dues_component_kind', ['BASE', 'SPORT', 'BENEFIT', 'ADJUSTMENT'])

export const duesPriceVersions = tesoreriaSchema.table(
  'dues_price_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: duesPriceKind('kind').notNull(),
    disciplinaId: uuid('disciplina_id').references(() => disciplinas.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    rule: duesAssessmentRule('rule').notNull(),
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
    lookupIdx: index('dues_price_versions_lookup_idx').on(
      table.kind,
      table.disciplinaId,
      table.effectiveFrom,
    ),
    activeIdx: index('dues_price_versions_active_idx')
      .on(table.kind, table.disciplinaId, table.effectiveFrom)
      .where(sql`${table.revokedAt} IS NULL`),
    amountCheck: check('dues_price_versions_amount_check', sql`${table.amount} >= 0`),
    // prettier-ignore
    intervalCheck: check('dues_price_versions_interval_check', sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`),
    // prettier-ignore
    kindDisciplineCheck: check('dues_price_versions_kind_discipline_check', sql`(${table.kind} = 'BASE' AND ${table.disciplinaId} IS NULL) OR (${table.kind} = 'SPORT' AND ${table.disciplinaId} IS NOT NULL)`),
    // prettier-ignore
    revokeCheck: check('dues_price_versions_revoke_check', sql`(${table.revokedAt} IS NULL AND ${table.revokedBy} IS NULL AND ${table.revokeReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedBy} IS NOT NULL AND ${table.revokeReason} IS NOT NULL AND btrim(${table.revokeReason}) <> '')`),
  }),
)

export const duesGenerationReceipts = tesoreriaSchema.table(
  'dues_generation_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    callerKey: text('caller_key').notNull(),
    requestFingerprint: char('request_fingerprint', { length: 64 }).notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    authorizationEvidence: jsonb('authorization_evidence').notNull().default({}),
    result: jsonb('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    operatorCallerKeyUnique: uniqueIndex('dues_generation_receipts_operator_caller_key_unique').on(
      table.operatorId,
      table.callerKey,
    ),
    // Range receipts use inclusive month-start / exclusive month-end bounds.
    periodCheck: check(
      'dues_generation_receipts_period_check',
      sql`${table.periodStart} = date_trunc('month', ${table.periodStart})::date AND ${table.periodEnd} > ${table.periodStart} AND ${table.periodEnd} = date_trunc('month', ${table.periodEnd})::date`,
    ),
    // prettier-ignore
    fingerprintCheck: check('dues_generation_receipts_fingerprint_check', sql`length(btrim(${table.requestFingerprint})) = 64`),
  }),
)

export const duesObligations = tesoreriaSchema.table(
  'dues_obligations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    kind: duesObligationKind('kind').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    generationReceiptId: uuid('generation_receipt_id')
      .notNull()
      .references(() => duesGenerationReceipts.id, { onDelete: 'restrict' }),
    compensatesObligationId: uuid('compensates_obligation_id').references(
      (): AnyPgColumn => duesObligations.id,
      { onDelete: 'restrict' },
    ),
    compensationReason: text('compensation_reason'),
    snapshot: jsonb('snapshot').notNull().default({}),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    authorizationEvidence: jsonb('authorization_evidence').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    socioPeriodIdx: index('dues_obligations_socio_period_idx').on(table.socioId, table.periodStart),
    monthlyNaturalKey: uniqueIndex('dues_obligations_monthly_natural_key')
      .on(table.socioId, table.periodStart)
      .where(sql`${table.kind} = 'MONTHLY_DUES'`),
    // prettier-ignore
    periodCheck: check('dues_obligations_period_check', sql`${table.periodEnd} > ${table.periodStart}`),
    // prettier-ignore
    kindCheck: check('dues_obligations_kind_check', sql`(${table.kind} = 'MONTHLY_DUES' AND ${table.amount} > 0 AND ${table.compensatesObligationId} IS NULL AND ${table.compensationReason} IS NULL) OR (${table.kind} = 'COMPENSATION' AND ${table.amount} <> 0 AND ${table.compensatesObligationId} IS NOT NULL AND ${table.compensationReason} IS NOT NULL AND btrim(${table.compensationReason}) <> '')`),
  }),
)

export const duesObligationComponents = tesoreriaSchema.table(
  'dues_obligation_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    obligationId: uuid('obligation_id')
      .notNull()
      .references(() => duesObligations.id, { onDelete: 'restrict' }),
    kind: duesComponentKind('kind').notNull(),
    componentKey: text('component_key').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    priceVersionId: uuid('price_version_id').references(() => duesPriceVersions.id, {
      onDelete: 'restrict',
    }),
    disciplinaId: uuid('disciplina_id').references(() => disciplinas.id, { onDelete: 'restrict' }),
    enrollmentId: uuid('enrollment_id').references(() => inscripciones.id, {
      onDelete: 'restrict',
    }),
    unitAmount: numeric('unit_amount', { precision: 14, scale: 2 }),
    rule: duesAssessmentRule('rule'),
    eligibleFrom: date('eligible_from'),
    eligibleTo: date('eligible_to'),
    eligibleDays: integer('eligible_days'),
    periodDays: integer('period_days'),
    calculationInputs: jsonb('calculation_inputs').notNull().default({}),
    eligibilitySnapshot: jsonb('eligibility_snapshot').notNull().default({}),
    priceSnapshot: jsonb('price_snapshot').notNull().default({}),
  },
  (table) => ({
    // prettier-ignore
    obligationKeyUnique: uniqueIndex('dues_obligation_components_obligation_key_unique').on(table.obligationId, table.componentKey),
    // prettier-ignore
    intervalCheck: check('dues_obligation_components_interval_check', sql`(${table.eligibleFrom} IS NULL AND ${table.eligibleTo} IS NULL) OR (${table.eligibleFrom} IS NOT NULL AND ${table.eligibleTo} IS NOT NULL AND ${table.eligibleTo} > ${table.eligibleFrom})`),
    // prettier-ignore
    daysCheck: check('dues_obligation_components_days_check', sql`${table.eligibleDays} IS NULL OR (${table.eligibleDays} >= 0 AND ${table.periodDays} IS NOT NULL AND ${table.periodDays} > 0 AND ${table.eligibleDays} <= ${table.periodDays})`),
    // prettier-ignore
    unitAmountCheck: check('dues_obligation_components_unit_amount_check', sql`${table.unitAmount} IS NULL OR ${table.unitAmount} >= 0`),
  }),
)

export const duesCondonationExecutions = tesoreriaSchema.table(
  'dues_condonation_executions',
  {
    executionId: uuid('execution_id').primaryKey(),
    approvalTokenId: uuid('approval_token_id')
      .notNull()
      .unique()
      .references(() => approvalTokens.id, { onDelete: 'restrict' }),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    currency: char('currency', { length: 3 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
    approvedSnapshot: jsonb('approved_snapshot').notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    totalCheck: check('dues_condonation_executions_total_check', sql`${table.totalAmount} > 0`),
    currencyCheck: check(
      'dues_condonation_executions_currency_check',
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  }),
)

export const duesCondonationTreatments = tesoreriaSchema.table(
  'dues_condonation_treatments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => duesCondonationExecutions.executionId, { onDelete: 'restrict' }),
    approvalTokenId: uuid('approval_token_id')
      .notNull()
      .references(() => approvalTokens.id, { onDelete: 'restrict' }),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    obligationId: uuid('obligation_id')
      .notNull()
      .references(() => duesObligations.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    approvedSnapshot: jsonb('approved_snapshot').notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    executionObligationUnique: uniqueIndex(
      'dues_condonation_treatments_execution_obligation_unique',
    ).on(table.executionId, table.obligationId),
    obligationIdx: index('dues_condonation_treatments_obligation_idx').on(table.obligationId),
    amountCheck: check('dues_condonation_treatments_amount_check', sql`${table.amount} > 0`),
    currencyCheck: check(
      'dues_condonation_treatments_currency_check',
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  }),
)

export type DuesPriceVersion = typeof duesPriceVersions.$inferSelect
export type NewDuesPriceVersion = typeof duesPriceVersions.$inferInsert
export type DuesGenerationReceipt = typeof duesGenerationReceipts.$inferSelect
export type NewDuesGenerationReceipt = typeof duesGenerationReceipts.$inferInsert
export type DuesObligation = typeof duesObligations.$inferSelect
export type NewDuesObligation = typeof duesObligations.$inferInsert
export type DuesObligationComponent = typeof duesObligationComponents.$inferSelect
export type NewDuesObligationComponent = typeof duesObligationComponents.$inferInsert
export type DuesCondonationExecution = typeof duesCondonationExecutions.$inferSelect
export type DuesCondonationTreatment = typeof duesCondonationTreatments.$inferSelect
