import type { Db } from '@athlos/db'
import type { Ctacte } from '@athlos/db/schema'
import {
  getMovimientos as repoGetMovimientos,
  getSaldo as repoGetSaldo,
  centsToString,
  parseCents,
} from './repository.ts'

/**
 * Cuenta Corriente service layer.
 *
 * Read-only in PR 5. There are NO writes — every flow that
 * generates a movement (cuota, cargo, pago, anulación) lands
 * with the ctacte write endpoints in a later PR. The saldo is
 * re-computed on every read so a partial migration or anulación
 * shows up in the response without an explicit invalidation step.
 *
 * The response shape:
 *
 *   { saldo, saldo_calculado_at, movimientos: [...] }
 *
 * `saldo_calculado_at` is the timestamp of the read so a client
 * can show "balance as of HH:MM" and so the audit trail has a
 * stable point of reference.
 */

export interface GetCuentaCorrienteInput {
  socioId: string
  page: number
  limit: number
  desde?: Date
  hasta?: Date
  incluirAnuladas?: boolean
}

export interface GetCuentaCorrienteResult {
  socioId: string
  saldo: string
  saldo_calculado_at: string
  movimientos: Array<Record<string, unknown>>
  page: number
  limit: number
  total: number
  has_more: boolean
}

/**
 * Build the canonical `cuenta-corriente` response: the socio's
 * current saldo (re-computed) plus a page of movements.
 */
export async function getCuentaCorriente(
  db: Db,
  input: GetCuentaCorrienteInput,
): Promise<GetCuentaCorrienteResult> {
  const [saldo, page] = await Promise.all([
    repoGetSaldo(db, input.socioId, {
      incluirAnuladas: input.incluirAnuladas ?? false,
    }),
    repoGetMovimientos(db, {
      socioId: input.socioId,
      ...(input.desde ? { desde: input.desde } : {}),
      ...(input.hasta ? { hasta: input.hasta } : {}),
      page: input.page,
      limit: input.limit,
    }),
  ])
  return {
    socioId: input.socioId,
    saldo,
    saldo_calculado_at: new Date().toISOString(),
    movimientos: page.items.map((row) => toMovimientoDTO(row, saldo)),
    page: page.page,
    limit: page.limit,
    total: page.total,
    has_more: page.page * page.limit < page.total,
  }
}

/**
 * Page through movements only. Useful for the dedicated
 * `/movimientos` endpoint where the caller already knows the
 * saldo and just wants the next page of rows.
 */
export async function listMovimientos(
  db: Db,
  input: GetCuentaCorrienteInput,
): Promise<{
  items: Array<Record<string, unknown>>
  page: number
  limit: number
  total: number
  has_more: boolean
}> {
  const result = await repoGetMovimientos(db, {
    socioId: input.socioId,
    ...(input.desde ? { desde: input.desde } : {}),
    ...(input.hasta ? { hasta: input.hasta } : {}),
    page: input.page,
    limit: input.limit,
  })
  return {
    items: result.items.map((row) => toMovimientoDTO(row, null)),
    page: result.page,
    limit: result.limit,
    total: result.total,
    has_more: result.page * result.limit < result.total,
  }
}

/**
 * Build the wire-shape `movimiento` DTO. `monto` is the net
 * (`debe - haber`); `saldo_resultante` is set when the caller
 * passed a `saldoFinal` (the canonical endpoint), and `null` for
 * the movimientos-only endpoint (the caller can compute the
 * running balance client-side if they need it).
 */
function toMovimientoDTO(row: Ctacte, saldoFinal: string | null): Record<string, unknown> {
  const debeCents = parseCents(String(row.debe))
  const haberCents = parseCents(String(row.haber))
  return {
    id: row.id,
    socio_id: row.socioId,
    fecha: row.fecha,
    tipo: row.tipo,
    concepto: row.concepto,
    debe: row.debe,
    haber: row.haber,
    anulado: row.anulado,
    anulado_at: row.anuladoAt ? row.anuladoAt.toISOString() : null,
    anulado_motivo: row.anuladoMotivo,
    monto: centsToString(debeCents - haberCents),
    saldo_resultante: saldoFinal,
    created_at: row.createdAt.toISOString(),
  }
}
