import { apiFetch } from '@/lib/api'

/**
 * Cuenta Corriente (ledger) API wrappers (TASK-023, PR 8b.2).
 *
 * Two read-only endpoints, both nested under `/api/v1/socios/:id`
 * so the URL is the canonical "this socio's ledger" view — a
 * consumer doesn't need to know which schema the data lives in.
 *
 *   GET /api/v1/socios/:id/cuenta-corriente
 *     Returns { socioId, saldo, saldo_calculado_at, movimientos,
 *               page, limit, total, has_more }
 *
 *   GET /api/v1/socios/:id/cuenta-corriente/movimientos
 *     Returns { items, page, limit, total, has_more } (movimientos only).
 *
 * The DTOs mirror the wire shape from `apps/api/src/modules/ctacte/service.ts`
 * (snake_case: `fecha`, `debe`, `haber`, `anulado`, `anulado_at`,
 * `anulado_motivo`, `saldo_calculado_at`, etc.) so the TypeScript
 * types stay in lock-step with the server response.
 *
 * `incluir_anuladas` is a string `'true'` / `'false'` because the
 * backend Zod schema uses `z.union([z.literal('true'), z.literal('false')])`
 * (per `apps/api/src/routes/ctacte.ts:34`). The wrapper normalizes
 * the caller's boolean to that literal set.
 *
 * PR 8b.2 is **read-only**: no create / update / delete wrappers
 * ship here. The orchestrator brief scopes this PR to the list +
 * detail flows only; write operations land in a later slice once
 * the ADMIN role-gated UI surfaces them.
 */

/** One row of the cuenta-corriente ledger. */
export interface Movimiento {
  id: string
  socio_id: string
  /** YYYY-MM-DD. */
  fecha: string
  tipo: 'DEBITO' | 'CREDITO'
  concepto: string
  /** NUMERIC(14,2) as a string (e.g., "1500.00"). */
  debe: string
  /** NUMERIC(14,2) as a string (e.g., "1500.00"). */
  haber: string
  anulado: boolean
  /** ISO-8601 timestamp or null. */
  anulado_at: string | null
  anulado_motivo: string | null
  /** Net (debe - haber) as a NUMERIC(14,2) string. */
  monto: string
  /** Canonical-saldo snapshot or null when called via /movimientos. */
  saldo_resultante: string | null
  /** ISO-8601 timestamp. */
  created_at: string
}

/** Wire shape of `GET /api/v1/socios/:id/cuenta-corriente`. */
export interface CtacteResponse {
  socioId: string
  /** NUMERIC(14,2) as a string. May be negative (credit balance). */
  saldo: string
  /** ISO-8601 timestamp of the read that produced the saldo. */
  saldo_calculado_at: string
  movimientos: Movimiento[]
  page: number
  limit: number
  total: number
  has_more: boolean
}

/** Wire shape of `GET /api/v1/socios/:id/cuenta-corriente/movimientos`. */
export interface MovimientoListResponse {
  items: Movimiento[]
  page: number
  limit: number
  total: number
  has_more: boolean
}

/** Optional filters / pagination for either cuenta-corriente endpoint. */
export interface CtacteParams {
  page?: number
  limit?: number
  /** ISO-8601 timestamp — inclusive lower bound. */
  desde?: string
  /** ISO-8601 timestamp — exclusive upper bound. */
  hasta?: string
  /** Default false. Pass true to include anuladas in the saldo. */
  incluir_anuladas?: boolean
}

/**
 * `getCtacte(socioId, params?)` — returns the socio's current
 * saldo (re-computed server-side) plus the first page of
 * movimientos. Throws `ApiError(404)` if the socioId is unknown.
 */
export function getCtacte(socioId: string, params: CtacteParams = {}): Promise<CtacteResponse> {
  return apiFetch<CtacteResponse>('/api/v1/socios/' + socioId + '/cuenta-corriente', {
    query: serializeParams(params),
  })
}

/**
 * `getMovimientos(socioId, params?)` — pages through the socio's
 * movimientos without re-fetching the saldo. Useful when the
 * detail page is on page 2+ (the saldo from the first call is
 * already known).
 */
export function getMovimientos(
  socioId: string,
  params: CtacteParams = {},
): Promise<MovimientoListResponse> {
  return apiFetch<MovimientoListResponse>(
    '/api/v1/socios/' + socioId + '/cuenta-corriente/movimientos',
    { query: serializeParams(params) },
  )
}

/**
 * Internal: turn the public `CtacteParams` into the query shape
 * the backend Zod schema expects. `incluir_anuladas` is coerced
 * to the literal `'true'` / `'false'` string set because the
 * backend `z.union([z.literal('true'), z.literal('false')])`
 * rejects plain booleans.
 */
function serializeParams(params: CtacteParams): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {}
  if (params.page !== undefined) out.page = params.page
  if (params.limit !== undefined) out.limit = params.limit
  if (params.desde !== undefined) out.desde = params.desde
  if (params.hasta !== undefined) out.hasta = params.hasta
  if (params.incluir_anuladas !== undefined) {
    out.incluir_anuladas = params.incluir_anuladas ? 'true' : 'false'
  }
  return out
}
