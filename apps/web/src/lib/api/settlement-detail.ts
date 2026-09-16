import { z } from 'zod'
import { apiFetch } from '@/lib/api'

const id = z.string().uuid()
const amount = z.number().int().positive().max(99_999_999_999_999)
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  })
const allocation = z
  .object({
    id,
    obligation_id: id,
    period_start: date,
    period_end: date,
    amount_cents: amount,
  })
  .refine((value) => value.period_end > value.period_start)
const schema = z
  .object({
    settlement_id: id,
    socio_id: id,
    member: z.object({
      id,
      numero_socio: z.string().min(1),
      nombre: z.string().min(1),
      apellido: z.string().min(1),
    }),
    confirmed_at: z.string().datetime(),
    amount_cents: amount,
    currency: z.string().regex(/^[A-Z]{3}$/),
    tender: z.enum(['CASH', 'DEBIT', 'CREDIT', 'TRANSFER']),
    allocations: z.array(allocation).min(1),
    reversal: z.object({ settlement_id: id, confirmed_at: z.string().datetime() }).nullable(),
  })
  .refine((value) => {
    const total = value.allocations.reduce((sum, item) => sum + item.amount_cents, 0)
    return Number.isSafeInteger(total) && total === value.amount_cents
  })

export type SettlementDetail = z.infer<typeof schema>

export async function getSettlementDetail(
  settlementId: string,
  expectedSocioId: string,
): Promise<SettlementDetail> {
  const raw = await apiFetch<unknown>(
    `/api/v1/dues/settlements/${encodeURIComponent(settlementId)}`,
    {
      method: 'GET',
      headers: { 'cache-control': 'no-store' },
    },
  )
  const parsed = schema.safeParse(raw)
  if (
    !parsed.success ||
    parsed.data.settlement_id !== settlementId ||
    parsed.data.socio_id !== expectedSocioId ||
    parsed.data.member.id !== expectedSocioId
  )
    throw new Error('Settlement detail response was incomplete')
  return parsed.data
}
