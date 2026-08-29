import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { DuesTransaction } from './repository.ts'

export type DuesDb = Db | DuesTransaction
type Json = Record<string, unknown>
export const MAX_MONEY_CENTS = 99_999_999_999_999
// prettier-ignore
export type SettlementKind = 'MONETARY' | 'NON_CASH';
export type AllocationKind = 'ALLOCATION' | 'COMPENSATION'
// prettier-ignore
export type SettlementInput = { operatorId:string; socioId:string; kind:SettlementKind; amountCents:number; currency:string; evidence:Json; reason?:string; reversalOfSettlementId?:string|null; callerKey:string; requestFingerprint:string; authorizationEvidence:Json }
// prettier-ignore
export type AllocationInput = { settlementId:string; socioId:string; obligationId:string; amountCents:number; kind?:AllocationKind; compensatesAllocationId?:string; reason?:string }
// prettier-ignore
export type SettlementRecord = { id:string; socioId:string; kind:SettlementKind; amountCents:number; currency:string; reversalOfSettlementId:string|null }
// prettier-ignore
export type AllocationRecord = { id:string; settlementId:string; obligationId:string; kind:AllocationKind; amountCents:number; compensatesAllocationId:string|null }
export type ReversibleSettlement = SettlementRecord & { allocations: AllocationRecord[] }
// prettier-ignore
export type SettlementClaim = { status:'claimed'; settlement:SettlementRecord } | { status:'replayed'; settlement:SettlementRecord; allocations:AllocationRecord[] }
// prettier-ignore
export type DebtStatus='ready'|'empty'|'not_found'
// prettier-ignore
export type DebtComponent={id:string;kind:'BASE'|'SPORT'|'BENEFIT'|'ADJUSTMENT';componentKey:string;amountCents:number}
// prettier-ignore
export type DebtAllocation={id:string;settlementId:string;settlementKind:SettlementKind;settlementAmountCents:number;currency:string;amountCents:number;kind:AllocationKind;compensatesAllocationId:string|null;reversalEligible:boolean}
// prettier-ignore
export type DebtObligation={id:string;periodStart:string;periodEnd:string;originalCents:number;outstandingCents:number;currency:string;status:'OPEN'|'PAID';components:DebtComponent[];benefits:Array<Pick<DebtComponent,'id'|'componentKey'|'amountCents'>>;allocations:DebtAllocation[]}
// prettier-ignore
export type DebtDetail={status:DebtStatus;socioId:string;currency:string|null;totalCents:number;obligations:DebtObligation[]}
export type FullOutstandingSelectionCommand = {
  socioId: string
  obligationIds: string[]
  selectionFingerprint?: string
}
export type FullOutstandingSelection = {
  socioId: string
  currency: string
  totalCents: number
  allocations: Array<{ obligationId: string; amountCents: number }>
  fingerprint: string
}
const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []
const jsonRows = <T>(value: unknown): T[] => (Array.isArray(value) ? value : []) as T[]
const money = (cents: number) => (cents / 100).toFixed(2)
const cents = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.')
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
}
// prettier-ignore
export function allocationTotal(items:Array<{ obligationId:string; amountCents:number }>):number { const seen = new Set<string>(); const total = items.reduce((sum, item) => { if (seen.has(item.obligationId) || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 || item.amountCents > MAX_MONEY_CENTS) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Allocations must contain unique positive amounts within the supported money range'); seen.add(item.obligationId); return sum + item.amountCents }, 0); if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_MONEY_CENTS) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'At least one allocation is required within the supported money range'); return total }
// prettier-ignore
const settlement = (row:{id:string;socioId:string;kind:SettlementKind;amount:string;currency:string;reversalOfSettlementId:string|null}):SettlementRecord => ({ id:row.id, socioId:row.socioId, kind:row.kind, amountCents:cents(row.amount), currency:row.currency, reversalOfSettlementId:row.reversalOfSettlementId })
// prettier-ignore
const allocation = (row:{id:string;settlementId:string;obligationId:string;kind:AllocationKind;amount:string;compensatesAllocationId:string|null}):AllocationRecord => ({ id:row.id, settlementId:row.settlementId, obligationId:row.obligationId, kind:row.kind, amountCents:cents(row.amount), compensatesAllocationId:row.compensatesAllocationId })
const settlementFields = sql`id, socio_id AS "socioId", kind, amount::text, btrim(currency) AS currency, reversal_of_settlement_id AS "reversalOfSettlementId"`
const allocationFields = sql`id, settlement_id AS "settlementId", obligation_id AS "obligationId", kind, amount::text, compensates_allocation_id AS "compensatesAllocationId"`
// prettier-ignore
export async function listAllocations(db:DuesDb, settlementId:string):Promise<AllocationRecord[]> { return rows<Parameters<typeof allocation>[0]>(await db.execute(sql`SELECT ${allocationFields} FROM tesoreria.dues_allocations WHERE settlement_id = ${settlementId} ORDER BY created_at, id`)).map(allocation) }
// prettier-ignore
export async function findReversibleSettlement(db:DuesDb,settlementId:string):Promise<ReversibleSettlement|null> { const original=rows<Parameters<typeof settlement>[0]>(await db.execute(sql`SELECT ${settlementFields} FROM tesoreria.dues_settlements WHERE id=${settlementId} FOR UPDATE`))[0]; if (!original) return null; const allocations=rows<Parameters<typeof allocation>[0]>(await db.execute(sql`SELECT ${allocationFields} FROM tesoreria.dues_allocations WHERE settlement_id=${settlementId} ORDER BY created_at,id FOR UPDATE`)).map(allocation); return {...settlement(original),allocations} }
export async function selectFullOutstanding(
  db: DuesDb,
  input: FullOutstandingSelectionCommand,
): Promise<FullOutstandingSelection> {
  const ids = [...input.obligationIds].sort()
  if (!ids.length || new Set(ids).size !== ids.length)
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'La selección debe indicar obligaciones únicas')
  const locked = rows<{ id: string; socioId: string; currency: string; outstanding: string }>(
    await db.execute(
      sql`SELECT o.id,o.socio_id AS "socioId",COALESCE(NULLIF(o.snapshot #>> '{inputs,currency}',''),'ARS') AS currency,GREATEST(o.amount-COALESCE((SELECT SUM(CASE WHEN a.kind='ALLOCATION' THEN a.amount ELSE -a.amount END) FROM tesoreria.dues_allocations a WHERE a.obligation_id=o.id),0)-COALESCE((SELECT SUM(t.amount) FROM tesoreria.dues_condonation_treatments t WHERE t.obligation_id=o.id),0),0)::text AS outstanding FROM tesoreria.dues_obligations o WHERE o.id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )}) ORDER BY o.id FOR UPDATE`,
    ),
  )
  if (locked.length !== ids.length || locked.some((row) => row.socioId !== input.socioId))
    throw BusinessError(ErrorCode.CONFLICT, 'La selección no pertenece al socio')
  locked.sort((left, right) => left.id.localeCompare(right.id))
  const currencies = new Set(locked.map((row) => row.currency))
  const allocations = locked.map((row) => ({
    obligationId: row.id,
    amountCents: cents(row.outstanding),
  }))
  if (
    currencies.size !== 1 ||
    allocations.some(
      (item) =>
        !Number.isSafeInteger(item.amountCents) ||
        item.amountCents <= 0 ||
        item.amountCents > MAX_MONEY_CENTS,
    )
  )
    throw BusinessError(ErrorCode.CONFLICT, 'La selección no tiene saldos abiertos compatibles')
  const totalCents = allocations.reduce((total, item) => total + item.amountCents, 0)
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > MAX_MONEY_CENTS)
    throw BusinessError(ErrorCode.CONFLICT, 'La selección no tiene un total válido')
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ socioId: input.socioId, currency: [...currencies][0], allocations }))
    .digest('hex')
  if (input.selectionFingerprint && input.selectionFingerprint !== fingerprint)
    throw BusinessError(ErrorCode.CONFLICT, 'La selección cambió; revisá los saldos')
  return {
    socioId: input.socioId,
    currency: [...currencies][0]!,
    totalCents,
    allocations,
    fingerprint,
  }
}
// prettier-ignore
export async function findSettlementReplay(db:DuesDb, operatorId:string, callerKey:string, requestFingerprint:string):Promise<Extract<SettlementClaim,{status:'replayed'}>|undefined> { const existing=rows<Parameters<typeof settlement>[0]>(await db.execute(sql`SELECT ${settlementFields} FROM tesoreria.dues_settlements WHERE operator_id=${operatorId} AND caller_key=${callerKey}`))[0]; if (!existing) return undefined; const fingerprint=rows<{requestFingerprint:string}>(await db.execute(sql`SELECT request_fingerprint AS "requestFingerprint" FROM tesoreria.dues_settlements WHERE id=${existing.id}`))[0]?.requestFingerprint; if (fingerprint!==requestFingerprint) throw BusinessError(ErrorCode.CONFLICT,'Idempotency key was already used for a different settlement'); return {status:'replayed',settlement:settlement(existing),allocations:await listAllocations(db,existing.id)} }
// prettier-ignore
export async function claimSettlement(db:DuesDb, input:SettlementInput):Promise<SettlementClaim> { const inserted = rows<Parameters<typeof settlement>[0]>(await db.execute(sql`INSERT INTO tesoreria.dues_settlements (socio_id,kind,amount,currency,evidence,reason,reversal_of_settlement_id,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES (${input.socioId},${input.kind},${money(input.amountCents)},${input.currency},${JSON.stringify(input.evidence)}::jsonb,${input.reason ?? null},${input.reversalOfSettlementId ?? null},${input.operatorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING ${settlementFields}`))[0]; if (inserted) return { status:'claimed', settlement:settlement(inserted) }; const existing = rows<Parameters<typeof settlement>[0]>(await db.execute(sql`SELECT ${settlementFields} FROM tesoreria.dues_settlements WHERE operator_id = ${input.operatorId} AND caller_key = ${input.callerKey}`))[0]; if (!existing) throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Settlement claim is unavailable'); const fingerprint = rows<{requestFingerprint:string}>(await db.execute(sql`SELECT request_fingerprint AS "requestFingerprint" FROM tesoreria.dues_settlements WHERE id = ${existing.id}`))[0]?.requestFingerprint; if (fingerprint !== input.requestFingerprint) throw BusinessError(ErrorCode.CONFLICT, 'Idempotency key was already used for a different settlement'); return { status:'replayed', settlement:settlement(existing), allocations:await listAllocations(db, existing.id) } }
// prettier-ignore
export async function insertAllocation(db:DuesDb, input:AllocationInput):Promise<AllocationRecord> { const kind = input.kind ?? 'ALLOCATION'; const s = rows<{socioId:string;amount:string}>(await db.execute(sql`SELECT socio_id AS "socioId", amount::text FROM tesoreria.dues_settlements WHERE id = ${input.settlementId}`))[0]; const o = rows<{id:string;socioId:string;amount:string}>(await db.execute(sql`SELECT id,socio_id AS "socioId",amount::text FROM tesoreria.dues_obligations WHERE id = ${input.obligationId} FOR UPDATE`))[0]; if (!s || !o) throw BusinessError(ErrorCode.NOT_FOUND, 'Settlement or obligation not found'); if (s.socioId !== input.socioId || o.socioId !== input.socioId) throw BusinessError(ErrorCode.CONFLICT, 'Settlement and obligation member do not match'); if (kind === 'COMPENSATION') { const original = rows<{obligationId:string;amount:string}>(await db.execute(sql`SELECT obligation_id AS "obligationId",amount::text FROM tesoreria.dues_allocations WHERE id = ${input.compensatesAllocationId}`))[0]; if (!original || original.obligationId !== input.obligationId || cents(original.amount) !== input.amountCents) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Compensation must restore the original allocation') } else { const outstanding = rows<{amount:string}>(await db.execute(sql`SELECT (${o.amount}::numeric - COALESCE(SUM(CASE WHEN kind = 'ALLOCATION' THEN amount ELSE -amount END),0))::text AS amount FROM tesoreria.dues_allocations WHERE obligation_id = ${input.obligationId}`))[0]; if (!outstanding || input.amountCents > cents(outstanding.amount)) throw BusinessError(ErrorCode.CONFLICT, 'Allocation exceeds the obligation balance'); const allocated = rows<{amount:string}>(await db.execute(sql`SELECT COALESCE(SUM(amount),0)::text AS amount FROM tesoreria.dues_allocations WHERE settlement_id = ${input.settlementId} AND kind = 'ALLOCATION'`))[0]; if (cents(allocated?.amount ?? '0') + input.amountCents > cents(s.amount)) throw BusinessError(ErrorCode.CONFLICT, 'Allocations exceed the settlement amount') } const inserted = rows<Parameters<typeof allocation>[0]>(await db.execute(sql`INSERT INTO tesoreria.dues_allocations (settlement_id,obligation_id,kind,amount,compensates_allocation_id,reason) VALUES (${input.settlementId},${input.obligationId},${kind},${money(input.amountCents)},${input.compensatesAllocationId ?? null},${input.reason ?? null}) RETURNING ${allocationFields}`))[0]; if (!inserted) throw BusinessError(ErrorCode.INTERNAL_ERROR, 'Allocation insert returned no row'); return allocation(inserted) }
// prettier-ignore
export async function findAllocation(db:DuesDb, allocationId:string) { const row = rows<Parameters<typeof allocation>[0] & {socioId:string;settlementKind:SettlementKind;currency:string}>(await db.execute(sql`SELECT a.id,a.settlement_id AS "settlementId",a.obligation_id AS "obligationId",a.kind,a.amount::text,a.compensates_allocation_id AS "compensatesAllocationId",s.socio_id AS "socioId",s.kind AS "settlementKind",btrim(s.currency) AS currency FROM tesoreria.dues_allocations a JOIN tesoreria.dues_settlements s ON s.id = a.settlement_id WHERE a.id = ${allocationId}`))[0]; return row ? {...allocation(row),socioId:row.socioId,settlementKind:row.settlementKind,currency:row.currency} : null }
export async function getDebt(db: DuesDb, socioId: string): Promise<DebtDetail> {
  try {
    const [member] = rows<{ exists: boolean }>(
      await db.execute(
        sql`SELECT EXISTS (SELECT 1 FROM socios.socios WHERE id = ${socioId}) AS exists`,
      ),
    )
    if (!member?.exists)
      return { status: 'not_found', socioId, currency: null, totalCents: 0, obligations: [] }
    const result = await db.execute(sql`
      SELECT o.id, o.period_start AS "periodStart", o.period_end AS "periodEnd", o.amount::text,
        GREATEST(o.amount - COALESCE(SUM(CASE WHEN a.kind = 'ALLOCATION' THEN a.amount ELSE -a.amount END), 0) - COALESCE((SELECT SUM(t.amount) FROM tesoreria.dues_condonation_treatments t WHERE t.obligation_id = o.id), 0), 0)::text AS outstanding,
        COALESCE(NULLIF(o.snapshot #>> '{inputs,currency}', ''), 'ARS') AS currency,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'componentKey', c.component_key, 'amount', c.amount::text) ORDER BY c.component_key, c.id)
          FROM tesoreria.dues_obligation_components c WHERE c.obligation_id = o.id), '[]'::jsonb) AS components,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', al.id, 'settlementId', al.settlement_id, 'settlementKind', s.kind, 'settlementAmount', s.amount::text, 'currency', btrim(s.currency), 'amount', al.amount::text, 'kind', al.kind, 'compensatesAllocationId', al.compensates_allocation_id, 'reversalEligible', (al.kind = 'ALLOCATION' AND NOT EXISTS (SELECT 1 FROM tesoreria.dues_allocations compensation WHERE compensation.compensates_allocation_id = al.id))) ORDER BY al.created_at, al.id)
          FROM tesoreria.dues_allocations al JOIN tesoreria.dues_settlements s ON s.id = al.settlement_id WHERE al.obligation_id = o.id), '[]'::jsonb) AS allocations
      FROM tesoreria.dues_obligations o
      LEFT JOIN tesoreria.dues_allocations a ON a.obligation_id = o.id
      WHERE o.socio_id = ${socioId} AND o.kind = 'MONTHLY_DUES'
      GROUP BY o.id, o.period_start, o.period_end, o.amount, o.snapshot
      ORDER BY o.period_start, o.id`)
    type ComponentRow = {
      id: string
      kind: DebtComponent['kind']
      componentKey: string
      amount: string
    }
    type AllocationRow = {
      id: string
      settlementId: string
      settlementKind: SettlementKind
      settlementAmount: string
      currency: string
      amount: string
      kind: AllocationKind
      compensatesAllocationId: string | null
      reversalEligible: boolean
    }
    const obligations = rows<{
      id: string
      periodStart: string
      periodEnd: string
      amount: string
      outstanding: string
      currency: string
      components: unknown
      allocations: unknown
    }>(result).map((row) => {
      const components = jsonRows<ComponentRow>(row.components).map((component) => ({
        id: component.id,
        kind: component.kind,
        componentKey: component.componentKey,
        amountCents: cents(component.amount),
      }))
      const allocations = jsonRows<AllocationRow>(row.allocations).map((allocation) => ({
        id: allocation.id,
        settlementId: allocation.settlementId,
        settlementKind: allocation.settlementKind,
        settlementAmountCents: cents(allocation.settlementAmount),
        currency: allocation.currency,
        amountCents: cents(allocation.amount),
        kind: allocation.kind,
        compensatesAllocationId: allocation.compensatesAllocationId,
        reversalEligible: allocation.reversalEligible,
      }))
      return {
        id: row.id,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        originalCents: cents(row.amount),
        outstandingCents: cents(row.outstanding),
        currency: row.currency,
        status: cents(row.outstanding) > 0 ? ('OPEN' as const) : ('PAID' as const),
        components,
        benefits: components
          .filter((component) => component.kind === 'BENEFIT')
          .map(({ id, componentKey, amountCents }) => ({ id, componentKey, amountCents })),
        allocations,
      }
    })
    const currencies = new Set(obligations.map((obligation) => obligation.currency))
    return {
      status: obligations.length ? 'ready' : 'empty',
      socioId,
      currency: currencies.size === 1 ? obligations[0]!.currency : null,
      totalCents: obligations.reduce((total, obligation) => total + obligation.outstandingCents, 0),
      obligations,
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Debt detail is unavailable')
  }
}
