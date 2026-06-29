import { apiFetch } from '@/lib/api'

/**
 * Gastos (expense ledger) API wrappers (TASK-009, PR n16b-web).
 *
 * Six ADMIN-only endpoints shipped in v0.5.19 (PR n16a-backend):
 *
 *   GET    /api/v1/gastos              — paginated list + filters
 *   GET    /api/v1/gastos/:id          — detail + joined links[]
 *   POST   /api/v1/gastos              — create (5-tuple UNIQUE enforced)
 *   PATCH  /api/v1/gastos/:id          — partial update
 *   DELETE /api/v1/gastos/:id          — hard delete (cascades to links)
 *   PATCH  /api/v1/gastos/:id/anular   — soft-delete (mapping rows remain)
 *
 * Wire shapes mirror `apps/api/src/routes/admin/gastos.ts`'s
 * `toGastoDTO()` — response is camelCase, request bodies are
 * snake_case (per the server's zod schemas).
 *
 * The `linkCount` field is only present on list rows; the detail
 * response carries a full `links: []` array instead.
 */

export interface Gasto {
  id: string
  tipo: number
  tipoCuenta: number
  cuentaPrincipal: string
  cuentaAuxiliar: number | null
  secuencia: number
  comprobante: string
  fecha: string
  concepto: string | null
  importe: string
  iva: string
  ingresoBruto: string | null
  socioId: string | null
  legacyId: string | null
  anulado: boolean
  anuladoAt: string | null
  anuladoMotivo: string | null
  createdAt: string
}

export interface GastoListResponse {
  items: (Gasto & { linkCount: number })[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

export interface GastoParams {
  page?: number
  limit?: number
  cuentaPrincipal?: string
  fechaDesde?: string
  fechaHasta?: string
  anulado?: boolean
}

export interface CreateGastoInput {
  tipo: number
  tipoCuenta: number
  cuentaPrincipal: string
  cuentaAuxiliar?: number | null
  secuencia?: number
  comprobante?: string
  fecha: string
  concepto?: string | null
  importe: string
  iva?: string
  ingresoBruto?: string | null
  socioId?: string | null
}

export interface UpdateGastoInput {
  tipo?: number
  tipoCuenta?: number
  cuentaPrincipal?: string
  cuentaAuxiliar?: number | null
  secuencia?: number
  comprobante?: string
  fecha?: string
  concepto?: string | null
  importe?: string
  iva?: string
  ingresoBruto?: string | null
  socioId?: string | null
}

function listQuery(p: GastoParams): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {}
  if (p.page !== undefined) out.page = p.page
  if (p.limit !== undefined) out.limit = p.limit
  if (p.cuentaPrincipal) out.cuenta_principal = p.cuentaPrincipal
  if (p.fechaDesde) out.fecha_desde = p.fechaDesde
  if (p.fechaHasta) out.fecha_hasta = p.fechaHasta
  if (p.anulado !== undefined) out.anulado = p.anulado ? 'true' : 'false'
  return out
}

/** Create body in the snake_case shape the server zod schema expects. */
function toCreateBody(i: CreateGastoInput): Record<string, unknown> {
  return {
    tipo: i.tipo,
    tipo_cuenta: i.tipoCuenta,
    cuenta_principal: i.cuentaPrincipal,
    ...(i.cuentaAuxiliar !== undefined ? { cuenta_auxiliar: i.cuentaAuxiliar } : {}),
    ...(i.secuencia !== undefined ? { secuencia: i.secuencia } : {}),
    ...(i.comprobante !== undefined ? { comprobante: i.comprobante } : {}),
    fecha: i.fecha,
    ...(i.concepto !== undefined ? { concepto: i.concepto } : {}),
    importe: i.importe,
    ...(i.iva !== undefined ? { iva: i.iva } : {}),
    ...(i.ingresoBruto !== undefined ? { ingreso_bruto: i.ingresoBruto } : {}),
    ...(i.socioId !== undefined ? { socio_id: i.socioId } : {}),
  }
}

function toUpdateBody(i: UpdateGastoInput): Record<string, unknown> {
  return {
    ...(i.tipo !== undefined ? { tipo: i.tipo } : {}),
    ...(i.tipoCuenta !== undefined ? { tipo_cuenta: i.tipoCuenta } : {}),
    ...(i.cuentaPrincipal !== undefined ? { cuenta_principal: i.cuentaPrincipal } : {}),
    ...(i.cuentaAuxiliar !== undefined ? { cuenta_auxiliar: i.cuentaAuxiliar } : {}),
    ...(i.secuencia !== undefined ? { secuencia: i.secuencia } : {}),
    ...(i.comprobante !== undefined ? { comprobante: i.comprobante } : {}),
    ...(i.fecha !== undefined ? { fecha: i.fecha } : {}),
    ...(i.concepto !== undefined ? { concepto: i.concepto } : {}),
    ...(i.importe !== undefined ? { importe: i.importe } : {}),
    ...(i.iva !== undefined ? { iva: i.iva } : {}),
    ...(i.ingresoBruto !== undefined ? { ingreso_bruto: i.ingresoBruto } : {}),
    ...(i.socioId !== undefined ? { socio_id: i.socioId } : {}),
  }
}

/** Paginated gastos list with filters. */
export function getGastos(params: GastoParams = {}): Promise<GastoListResponse> {
  return apiFetch<GastoListResponse>('/api/v1/gastos', { query: listQuery(params) })
}

/** Single gasto detail (camelCase fields + joined `links[]` from mapping). */
export function getGastoById(id: string): Promise<Gasto & { links?: unknown[] }> {
  return apiFetch<Gasto & { links?: unknown[] }>('/api/v1/gastos/' + id, { query: {} })
}

/** Create a new gasto (5-tuple UNIQUE enforced server-side → 409 on dup). */
export function createGasto(input: CreateGastoInput): Promise<Gasto> {
  return apiFetch<Gasto>('/api/v1/gastos', { method: 'POST', body: toCreateBody(input) })
}

/** Partial update of a gasto. */
export function updateGasto(id: string, input: UpdateGastoInput): Promise<Gasto> {
  return apiFetch<Gasto>('/api/v1/gastos/' + id, {
    method: 'PATCH',
    body: toUpdateBody(input),
  })
}

/** Hard-delete a gasto (ON DELETE CASCADE removes its links). */
export function deleteGasto(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/v1/gastos/' + id, { method: 'DELETE' })
}

/** Soft-delete a gasto (links remain as audit trail). */
export function anularGasto(id: string, motivo: string): Promise<Gasto> {
  return apiFetch<Gasto>('/api/v1/gastos/' + id + '/anular', {
    method: 'PATCH',
    body: { motivo },
  })
}
