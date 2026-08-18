import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
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
import { tesoreriaSchema } from './tesoreria.ts'
import { duesObligations } from './dues.ts'

// prettier-ignore
export const duesSettlementKind=tesoreriaSchema.enum('dues_settlement_kind',['MONETARY','NON_CASH'])
// prettier-ignore
export const duesAllocationKind=tesoreriaSchema.enum('dues_allocation_kind',['ALLOCATION','COMPENSATION'])
// prettier-ignore
export const duesSettlements=tesoreriaSchema.table('dues_settlements',{id:uuid('id').primaryKey().defaultRandom(),socioId:uuid('socio_id').notNull().references(()=>socios.id,{onDelete:'restrict'}),kind:duesSettlementKind('kind').notNull(),amount:numeric('amount',{precision:14,scale:2}).notNull(),currency:char('currency',{length:3}).notNull().default('ARS'),evidence:jsonb('evidence').notNull().default({}),reason:text('reason'),reversalOfSettlementId:uuid('reversal_of_settlement_id').references(():AnyPgColumn=>duesSettlements.id,{onDelete:'restrict'}),operatorId:uuid('operator_id').notNull().references(()=>operators.id,{onDelete:'restrict'}),authorizationEvidence:jsonb('authorization_evidence').notNull().default({}),callerKey:text('caller_key').notNull(),requestFingerprint:char('request_fingerprint',{length:64}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},table=>({operatorCallerKeyUnique:uniqueIndex('dues_settlements_operator_caller_key_unique').on(table.operatorId,table.callerKey),socioIdx:index('dues_settlements_socio_idx').on(table.socioId,table.createdAt),amountCheck:check('dues_settlements_amount_check',sql`${table.amount} > 0`),currencyCheck:check('dues_settlements_currency_check',sql`${table.currency} ~ '^[A-Z]{3}$'`),fingerprintCheck:check('dues_settlements_fingerprint_check',sql`length(btrim(${table.requestFingerprint})) = 64`),reversalCheck:check('dues_settlements_reversal_check',sql`(${table.reversalOfSettlementId} IS NULL) OR (${table.reversalOfSettlementId} IS NOT NULL AND ${table.reason} IS NOT NULL AND btrim(${table.reason}) <> '')`)}))
// prettier-ignore
export const duesAllocations=tesoreriaSchema.table('dues_allocations',{id:uuid('id').primaryKey().defaultRandom(),settlementId:uuid('settlement_id').notNull().references(()=>duesSettlements.id,{onDelete:'restrict'}),obligationId:uuid('obligation_id').notNull().references(()=>duesObligations.id,{onDelete:'restrict'}),kind:duesAllocationKind('kind').notNull(),amount:numeric('amount',{precision:14,scale:2}).notNull(),compensatesAllocationId:uuid('compensates_allocation_id').references(():AnyPgColumn=>duesAllocations.id,{onDelete:'restrict'}),reason:text('reason'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},table=>({settlementObligationUnique:uniqueIndex('dues_allocations_settlement_obligation_kind_unique').on(table.settlementId,table.obligationId,table.kind),compensationUnique:uniqueIndex('dues_allocations_compensation_unique').on(table.compensatesAllocationId).where(sql`${table.compensatesAllocationId} IS NOT NULL`),obligationIdx:index('dues_allocations_obligation_idx').on(table.obligationId),amountCheck:check('dues_allocations_amount_check',sql`${table.amount} > 0`),kindCheck:check('dues_allocations_kind_check',sql`(${table.kind} = 'ALLOCATION' AND ${table.compensatesAllocationId} IS NULL AND ${table.reason} IS NULL) OR (${table.kind} = 'COMPENSATION' AND ${table.compensatesAllocationId} IS NOT NULL AND ${table.reason} IS NOT NULL AND btrim(${table.reason}) <> '')`)}))
// prettier-ignore
export type DuesSettlement=typeof duesSettlements.$inferSelect;
export type NewDuesSettlement = typeof duesSettlements.$inferInsert
export type DuesAllocation = typeof duesAllocations.$inferSelect
export type NewDuesAllocation = typeof duesAllocations.$inferInsert
