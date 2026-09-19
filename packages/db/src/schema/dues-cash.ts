import { sql } from 'drizzle-orm'
// prettier-ignore
import { type AnyPgColumn, boolean, check, date, index, jsonb, numeric, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'
import { duesSettlements } from './dues-settlements.ts'
import { gastos, tesoreriaSchema } from './tesoreria.ts'
// prettier-ignore
export const duesCashShifts=tesoreriaSchema.table('dues_cash_shifts',{id:uuid('id').primaryKey().defaultRandom(),deskId:text('desk_id').notNull(),assignedOperatorId:uuid('assigned_operator_id').notNull().references(()=>operators.id),status:text('status').notNull().default('OPEN'),openingTenders:jsonb('opening_tenders').notNull().default({}),operatorId:uuid('operator_id').notNull().references(()=>operators.id),authorizationEvidence:jsonb('authorization_evidence').notNull().default({}),callerKey:text('caller_key').notNull(),requestFingerprint:text('request_fingerprint').notNull(),businessDate:date('business_date').notNull(),timezone:text('timezone').notNull().default('America/Argentina/Jujuy'),openedAt:timestamp('opened_at',{withTimezone:true}).notNull().defaultNow(),closedAt:timestamp('closed_at',{withTimezone:true})},t=>({statusCheck:check('dues_cash_shift_status_check',sql`${t.status} IN ('OPEN','CLOSED')`),timezoneCheck:check('dues_cash_shift_timezone_check',sql`${t.timezone} = 'America/Argentina/Jujuy'`),openOperator:uniqueIndex('dues_cash_shift_open_operator_unique').on(t.assignedOperatorId).where(sql`${t.status} = 'OPEN'`),callerUnique:uniqueIndex('dues_cash_shift_operator_key_unique').on(t.operatorId,t.callerKey),deskIdx:index('dues_cash_shift_desk_idx').on(t.deskId,t.openedAt)}))
// prettier-ignore
export const duesCashTenders=tesoreriaSchema.table('dues_cash_tenders',{id:uuid('id').primaryKey().defaultRandom(),shiftId:uuid('shift_id').notNull().references(()=>duesCashShifts.id),direction:text('direction').notNull(),tender:text('tender').notNull(),amount:numeric('amount',{precision:14,scale:2}).notNull(),sourceType:text('source_type').notNull(),sourceId:uuid('source_id'),reason:text('reason'),operatorId:uuid('operator_id').notNull().references(()=>operators.id),callerKey:text('caller_key').notNull(),requestFingerprint:text('request_fingerprint').notNull(),reversesTenderId:uuid('reverses_tender_id').references(():AnyPgColumn=>duesCashTenders.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({amountCheck:check('dues_cash_tender_amount_check',sql`${t.amount} > 0`),sourceCheck:check('dues_cash_tender_source_check',sql`(${t.sourceType} = 'MANUAL' AND ${t.sourceId} IS NULL) OR (${t.sourceType} IN ('SETTLEMENT','GASTO') AND ${t.sourceId} IS NOT NULL)`),manualReasonCheck:check('dues_cash_tender_manual_reason_check',sql`${t.sourceType} <> 'MANUAL' OR NULLIF(BTRIM(${t.reason}), '') IS NOT NULL`),shiftIdx:index('dues_cash_tender_shift_idx').on(t.shiftId),sourceUnique:uniqueIndex('dues_cash_tender_source_unique').on(t.shiftId,t.sourceType,t.sourceId).where(sql`${t.sourceId} IS NOT NULL`),callerUnique:uniqueIndex('dues_cash_tender_operator_key_unique').on(t.operatorId,t.callerKey)}))
// prettier-ignore
export const duesCashSources=tesoreriaSchema.table('dues_cash_sources',{id:uuid('id').primaryKey().defaultRandom(),shiftId:uuid('shift_id').notNull().references(()=>duesCashShifts.id,{onDelete:'restrict'}),settlementId:uuid('settlement_id').notNull().references(()=>duesSettlements.id,{onDelete:'restrict'}),origin:text('origin').notNull(),accountCodeSnapshot:text('account_code_snapshot').notNull(),accountNameSnapshot:text('account_name_snapshot').notNull(),accountPathSnapshot:jsonb('account_path_snapshot').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({settlementUnique:uniqueIndex('dues_cash_source_settlement_unique').on(t.settlementId),originCheck:check('dues_cash_source_origin_check',sql`${t.origin} = 'AUTOMATIC_DUES_PRODUCTION'`),duesSnapshotCheck:check('dues_cash_source_dues_snapshot_check',sql`${t.accountCodeSnapshot} = '4.1.01' AND ${t.accountNameSnapshot} = 'Cuotas sociales' AND ${t.accountPathSnapshot} = '[{"code":"4","name":"Ingresos"},{"code":"4.1","name":"Ingresos Operativos"},{"code":"4.1.01","name":"Cuotas sociales"}]'::jsonb`)}))
// prettier-ignore
export const duesCashManualSources=tesoreriaSchema.table('dues_cash_manual_sources',{id:uuid('id').primaryKey().defaultRandom(),tenderId:uuid('tender_id').notNull().references(()=>duesCashTenders.id,{onDelete:'restrict'}),accountCodeSnapshot:text('account_code_snapshot').notNull(),accountNameSnapshot:text('account_name_snapshot').notNull(),accountPathSnapshot:jsonb('account_path_snapshot').notNull(),description:text('description').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({tenderUnique:unique('dues_cash_manual_source_tender_unique').on(t.tenderId),descriptionCheck:check('dues_cash_manual_source_description_check',sql`NULLIF(BTRIM(${t.description}), '') IS NOT NULL`)}))
// prettier-ignore
export const duesCashSupportingRecords=tesoreriaSchema.table('dues_cash_supporting_records',{id:uuid('id').primaryKey().defaultRandom(),manualSourceId:uuid('manual_source_id').notNull().references(()=>duesCashManualSources.id,{onDelete:'restrict'}),kind:text('kind').notNull(),docType:text('doc_type'),letter:text('letter'),pointOfSale:text('point_of_sale'),docNumber:text('doc_number'),legend:text('legend'),issuer:text('issuer'),recipient:text('recipient'),issueDate:date('issue_date'),currency:text('currency').notNull().default('ARS'),total:numeric('total',{precision:14,scale:2}).notNull(),priorReferences:jsonb('prior_references').notNull().default([]),taxComponents:jsonb('tax_components').notNull().default([]),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({sourceUnique:unique('dues_cash_supporting_record_source_unique').on(t.manualSourceId),kindCheck:check('dues_cash_supporting_record_kind_check',sql`${t.kind} IN ('EXTERNAL','INTERNAL')`),totalCheck:check('dues_cash_supporting_record_total_check',sql`${t.total} > 0`),internalUnnumbered:check('dues_cash_supporting_record_internal_unnumbered',sql`${t.kind} <> 'INTERNAL' OR (${t.docType} IS NULL AND ${t.docNumber} IS NULL AND ${t.pointOfSale} IS NULL)`)}))

// prettier-ignore
export const duesCashCloses=tesoreriaSchema.table('dues_cash_closes',{id:uuid('id').primaryKey().defaultRandom(),shiftId:uuid('shift_id').notNull().unique().references(()=>duesCashShifts.id),expectedTenders:jsonb('expected_tenders').notNull(),countedTenders:jsonb('counted_tenders').notNull(),discrepancy:jsonb('discrepancy').notNull(),reason:text('reason'),forceClose:boolean('force_close').notNull().default(false),operatorId:uuid('operator_id').notNull().references(()=>operators.id),authorizationEvidence:jsonb('authorization_evidence').notNull().default({}),callerKey:text('caller_key').notNull(),requestFingerprint:text('request_fingerprint').notNull(),closedAt:timestamp('closed_at',{withTimezone:true}).notNull().defaultNow()})
// prettier-ignore
export const duesCashCloseTransfers=tesoreriaSchema.table('dues_cash_close_transfers',{id:uuid('id').primaryKey().defaultRandom(),closeId:uuid('close_id').notNull().references(()=>duesCashCloses.id,{onDelete:'restrict'}),shiftId:uuid('shift_id').notNull().references(()=>duesCashShifts.id,{onDelete:'restrict'}),accountCodeSnapshot:text('account_code_snapshot').notNull(),accountNameSnapshot:text('account_name_snapshot').notNull(),accountPathSnapshot:jsonb('account_path_snapshot').notNull(),amount:numeric('amount',{precision:14,scale:2}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({closeUnique:unique('dues_cash_close_transfer_close_unique').on(t.closeId),shiftUnique:unique('dues_cash_close_transfer_shift_unique').on(t.shiftId),amountCheck:check('dues_cash_close_transfer_amount_check',sql`${t.amount} > 0`)}))
// prettier-ignore
export const duesCashShiftExpenses=tesoreriaSchema.table('dues_cash_shift_expenses',{id:uuid('id').primaryKey().defaultRandom(),shiftId:uuid('shift_id').notNull().references(()=>duesCashShifts.id),gastoId:uuid('gasto_id').notNull().references(()=>gastos.id),operatorId:uuid('operator_id').notNull().references(()=>operators.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({oneShiftExpense:uniqueIndex('dues_cash_shift_expense_unique').on(t.gastoId),shiftIdx:index('dues_cash_shift_expense_shift_idx').on(t.shiftId)})) // prettier-ignore
export const gastoCompensations = tesoreriaSchema.table(
  'gasto_compensations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    originalGastoId: uuid('original_gasto_id')
      .notNull()
      .references(() => gastos.id),
    compensatingGastoId: uuid('compensating_gasto_id')
      .notNull()
      .references(() => gastos.id),
    reason: text('reason').notNull(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    callerKey: text('caller_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    callerUnique: uniqueIndex('gasto_compensation_operator_key_unique').on(
      t.operatorId,
      t.callerKey,
    ),
  }),
)

export const gastoMutationReceipts = tesoreriaSchema.table(
  'gasto_mutation_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    callerKey: text('caller_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    callerUnique: uniqueIndex('gasto_mutation_receipt_operator_key_unique').on(
      t.operatorId,
      t.callerKey,
    ),
  }),
)
// prettier-ignore
export type DuesCashShift=typeof duesCashShifts.$inferSelect
// prettier-ignore
export type DuesCashClose=typeof duesCashCloses.$inferSelect
