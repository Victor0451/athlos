import { z } from 'zod'
import { dateRangeSchema, idSchema, paginationSchema } from '../primitives.ts'

/**
 * Cuenta Corriente (account current / ledger) query schema.
 *
 * Read-only in Phase 1 — writes (DEBITO / CREDITO rows, anulaciones)
 * land with the ctacte write endpoints in PR 5+ once the business
 * flows are signed off. The shape is intentionally compact: a
 * socio-scoped query with a date range and the standard pagination.
 */
export const ctacteQuerySchema = paginationSchema.extend({
  socio_id: idSchema.optional(),
  desde: dateRangeSchema.shape.desde,
  hasta: dateRangeSchema.shape.hasta,
  // Filter on a specific tipo (DEBITO | CREDITO). Nullable so a
  // default query returns both.
  tipo: z.enum(['DEBITO', 'CREDITO']).optional(),
  // Exclude anulados by default — the spec says anuladas must never
  // silently leak into the saldo computation. Setting `incluir_anuladas=true`
  // is the only way the operator can audit an anulación.
  incluir_anuladas: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),
})

export type CtacteQuery = z.infer<typeof ctacteQuerySchema>
