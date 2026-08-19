import { sql } from 'drizzle-orm'
// prettier-ignore
import { boolean, check, date, index, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'
import { gastos, tesoreriaSchema } from './tesoreria.ts'
// prettier-ignore
export const duesCashShifts=tesoreriaSchema.table('dues_cash_shifts',{id:uuid('id').primaryKey().defaultRandom(),deskId:text('desk_id').notNull(),assignedOperatorId:uuid('assigned_operator_id').notNull().references(()=>operators.id),status:text('status').notNull().default('OPEN'),openingTenders:jsonb('opening_tenders').notNull().default({}),operatorId:uuid('operator_id').notNull().references(()=>operators.id),authorizationEvidence:jsonb('authorization_evidence').notNull().default({}),callerKey:text('caller_key').notNull(),requestFingerprint:text('request_fingerprint').notNull(),businessDate:date('business_date').notNull(),timezone:text('timezone').notNull().default('America/Argentina/Jujuy'),openedAt:timestamp('opened_at',{withTimezone:true}).notNull().defaultNow(),closedAt:timestamp('closed_at',{withTimezone:true})},t=>({statusCheck:check('dues_cash_shift_status_check',sql`${t.status} IN ('OPEN','CLOSED')`),timezoneCheck:check('dues_cash_shift_timezone_check',sql`${t.timezone} = 'America/Argentina/Jujuy'`),openDesk:uniqueIndex('dues_cash_shift_open_desk_unique').on(t.deskId).where(sql`${t.status} = 'OPEN'`),callerUnique:uniqueIndex('dues_cash_shift_operator_key_unique').on(t.operatorId,t.callerKey),deskIdx:index('dues_cash_shift_desk_idx').on(t.deskId,t.openedAt)}))
// prettier-ignore
export const duesCashTenders=tesoreriaSchema.table('dues_cash_tenders',{id:uuid('id').primaryKey().defaultRandom(),shiftId:uuid('shift_id').notNull().references(()=>duesCashShifts.id),direction:text('direction').notNull(),tender:text('tender').notNull(),amount:numeric('amount',{precision:14,scale:2}).notNull(),sourceType:text('source_type').notNull(),sourceId:uuid('source_id'),reason:text('reason'),operatorId:uuid('operator_id').notNull().references(()=>operators.id),callerKey:text('caller_key').notNull(),requestFingerprint:text('request_fingerprint').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({amountCheck:check('dues_cash_tender_amount_check',sql`${t.amount} > 0`),sourceCheck:check('dues_cash_tender_source_check',sql`(${t.sourceType} = 'MANUAL' AND ${t.sourceId} IS NULL) OR (${t.sourceType} IN ('SETTLEMENT','GASTO') AND ${t.sourceId} IS NOT NULL)`),manualReasonCheck:check('dues_cash_tender_manual_reason_check',sql`${t.sourceType} <> 'MANUAL' OR NULLIF(BTRIM(${t.reason}), '') IS NOT NULL`),shiftIdx:index('dues_cash_tender_shift_idx').on(t.shiftId),sourceUnique:uniqueIndex('dues_cash_tender_source_unique').on(t.shiftId,t.sourceType,t.sourceId).where(sql`${t.sourceId} IS NOT NULL`),callerUnique:uniqueIndex('dues_cash_tender_operator_key_unique').on(t.operatorId,t.callerKey)}))
// prettier-ignore
export const duesCashShiftExpenses=tesoreriaSchema.table('dues_cash_shift_expenses',{id:uuid('id').primaryKey().defaultRandom(),shiftId:uuid('shift_id').notNull().references(()=>duesCashShifts.id),gastoId:uuid('gasto_id').notNull().references(()=>gastos.id),operatorId:uuid('operator_id').notNull().references(()=>operators.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({oneShiftExpense:uniqueIndex('dues_cash_shift_expense_unique').on(t.gastoId),shiftIdx:index('dues_cash_shift_expense_shift_idx').on(t.shiftId)}))
// prettier-ignore
export const duesCashCloses=tesoreriaSchema.table('dues_cash_closes',{id:uuid('id').primaryKey().defaultRandom(),shiftId:uuid('shift_id').notNull().unique().references(()=>duesCashShifts.id),expectedTenders:jsonb('expected_tenders').notNull(),countedTenders:jsonb('counted_tenders').notNull(),discrepancy:jsonb('discrepancy').notNull(),reason:text('reason'),forceClose:boolean('force_close').notNull().default(false),operatorId:uuid('operator_id').notNull().references(()=>operators.id),authorizationEvidence:jsonb('authorization_evidence').notNull().default({}),callerKey:text('caller_key').notNull(),requestFingerprint:text('request_fingerprint').notNull(),closedAt:timestamp('closed_at',{withTimezone:true}).notNull().defaultNow()})
// prettier-ignore
export const gastoCompensations=tesoreriaSchema.table('gasto_compensations',{id:uuid('id').primaryKey().defaultRandom(),originalGastoId:uuid('original_gasto_id').notNull().references(()=>gastos.id),compensatingGastoId:uuid('compensating_gasto_id').notNull().references(()=>gastos.id),reason:text('reason').notNull(),operatorId:uuid('operator_id').notNull().references(()=>operators.id),callerKey:text('caller_key').notNull(),requestFingerprint:text('request_fingerprint').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>({callerUnique:uniqueIndex('gasto_compensation_operator_key_unique').on(t.operatorId,t.callerKey)}))

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
