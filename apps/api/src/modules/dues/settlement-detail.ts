import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { MAX_MONEY_CENTS } from './allocations.ts'
import type { AuditContext } from './service.ts'

type TenderFact = { tender: string; amount: string; operatorId: string }
type AllocationFact = {
  id: string
  obligationId: string
  socioId: string
  currency: string
  periodStart: string
  periodEnd: string
  amount: string
}
type DbRow = {
  id: string
  socioId: string
  operatorId: string
  kind: string
  reversalOfSettlementId: string | null
  amount: string
  currency: string
  createdAt: Date
  memberId: string | null
  memberNumber: string | null
  memberFirstName: string | null
  memberLastName: string | null
  tenders: TenderFact[]
  allocations: AllocationFact[]
  reversal: Array<{ settlementId: string; createdAt: string }>
}

function unavailable(): never {
  throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Settlement detail is unavailable')
}

function cents(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) unavailable()
  const [whole, fraction = ''] = value.split('.')
  const amount = Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MONEY_CENTS) unavailable()
  return amount
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) unavailable()
  return date.toISOString()
}

function period(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || timestamp(`${value}T00:00:00Z`).slice(0, 10) !== value)
    unavailable()
  return value
}

function detail(row: DbRow) {
  if (
    !row.memberId ||
    row.memberId !== row.socioId ||
    !row.memberNumber ||
    !row.memberFirstName ||
    !row.memberLastName ||
    !/^[A-Z]{3}$/.test(row.currency)
  )
    unavailable()
  const amountCents = cents(row.amount)
  const tender = row.tenders[0]
  if (
    row.tenders.length !== 1 ||
    !tender ||
    !['CASH', 'DEBIT', 'CREDIT', 'TRANSFER'].includes(tender.tender) ||
    tender.operatorId !== row.operatorId ||
    cents(tender.amount) !== amountCents
  )
    unavailable()
  const allocations = row.allocations.map((item) => {
    if (item.socioId !== row.socioId || item.currency !== row.currency) unavailable()
    const start = period(item.periodStart)
    const end = period(item.periodEnd)
    if (end <= start) unavailable()
    return {
      id: item.id,
      obligation_id: item.obligationId,
      period_start: start,
      period_end: end,
      amount_cents: cents(item.amount),
    }
  })
  const total = allocations.reduce((sum, item) => sum + item.amount_cents, 0)
  if (!allocations.length || !Number.isSafeInteger(total) || total !== amountCents) unavailable()
  if (!Array.isArray(row.reversal) || row.reversal.length > 1) unavailable()
  const reversal = row.reversal[0]
  return {
    settlement_id: row.id,
    socio_id: row.socioId,
    member: {
      id: row.memberId,
      numero_socio: row.memberNumber,
      nombre: row.memberFirstName,
      apellido: row.memberLastName,
    },
    confirmed_at: timestamp(row.createdAt),
    amount_cents: amountCents,
    currency: row.currency,
    tender: tender.tender as 'CASH' | 'DEBIT' | 'CREDIT' | 'TRANSFER',
    allocations,
    reversal: reversal
      ? { settlement_id: reversal.settlementId, confirmed_at: timestamp(reversal.createdAt) }
      : null,
  }
}

export type SettlementDetail = ReturnType<typeof detail>

export async function getSettlementDetail(
  db: Db,
  role: AuditContext['role'],
  settlementId: string,
) {
  if (role !== 'ADMIN' && role !== 'TESORERO')
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Settlement detail is not authorized')
  try {
    const result = await db.execute<DbRow>(sql`
      SELECT s.id, s.socio_id AS "socioId", s.operator_id AS "operatorId", s.kind,
        s.reversal_of_settlement_id AS "reversalOfSettlementId",
        s.amount::text, btrim(s.currency) AS currency, s.created_at AS "createdAt",
        member.id AS "memberId", member.numero_socio AS "memberNumber",
        member.nombre AS "memberFirstName", member.apellido AS "memberLastName",
        COALESCE(tenders.items, '[]'::jsonb) AS tenders,
        COALESCE(allocations.items, '[]'::jsonb) AS allocations,
        COALESCE(reversal.items, '[]'::jsonb) AS reversal
      FROM tesoreria.dues_settlements s
      LEFT JOIN socios.socios member ON member.id = s.socio_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'tender', t.tender, 'amount', t.amount::text, 'operatorId', t.operator_id
        ) ORDER BY t.created_at, t.id) AS items
        FROM tesoreria.dues_cash_tenders t
        WHERE t.source_type = 'SETTLEMENT' AND t.direction = 'INCOME' AND t.source_id = s.id
      ) tenders ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'obligationId', a.obligation_id, 'socioId', o.socio_id,
          'currency', COALESCE(NULLIF(o.snapshot #>> '{inputs,currency}', ''), 'ARS'),
          'periodStart', o.period_start, 'periodEnd', o.period_end, 'amount', a.amount::text
        ) ORDER BY a.created_at, a.id) AS items
        FROM tesoreria.dues_allocations a
        LEFT JOIN tesoreria.dues_obligations o ON o.id = a.obligation_id
        WHERE a.settlement_id = s.id AND a.kind = 'ALLOCATION'
      ) allocations ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'settlementId', r.id, 'createdAt', r.created_at
        ) ORDER BY r.created_at, r.id) AS items
        FROM tesoreria.dues_settlements r WHERE r.reversal_of_settlement_id = s.id
      ) reversal ON true
      WHERE s.id = ${settlementId} AND s.kind = 'MONETARY' AND s.reversal_of_settlement_id IS NULL
    `)
    const row = result.rows[0]
    if (!row || row.kind !== 'MONETARY' || row.reversalOfSettlementId !== null)
      throw BusinessError(ErrorCode.NOT_FOUND, 'Settlement not found')
    return detail(row)
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    unavailable()
  }
}
