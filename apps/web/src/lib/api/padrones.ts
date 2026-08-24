import { apiFetch } from '@/lib/api'

/**
 * Padrones API wrappers (TASK-027, PR 8b.3).
 *
 * The padrones source exposes a discipline catalog and one read-only
 * endpoint, `GET /api/v1/padrones`, with TWO required query params —
 * `disciplina` (string codigo, e.g. 'NATACION') and `ejercicio`
 * (number year, e.g. 2026).
 *
 *   GET /api/v1/padrones?disciplina=NATACION&ejercicio=2026
 *     Returns { disciplina, ejercicio, items, page, limit, total, has_more }
 *
 * The DTOs mirror the wire shape verbatim from
 * `apps/api/src/modules/padrones/repository.ts` (camelCase:
 * `inscripcionId`, `socioId`, `numeroSocio`, `fechaAlta`,
 * `disciplinaCodigo`, `disciplinaNombre`, `ejercicioAnio`).
 * The padrones route does NOT apply a `toXxxDTO` snake_case
 * mapper (unlike `socios.ts`), so the wire shape is camelCase
 * end-to-end.
 *
 * Both params are required by the backend zod schema
 * (`apps/api/src/routes/padrones.ts:22-27`). Missing either
 * returns 400 with a field path; an unknown codigo or year
 * returns 404. The wrapper does not catch either — the caller
 * (`useQuery`) gets the `ApiError` and the page renders the
 * "Padrón no encontrado" state.
 *
 * PR 8b.3 is **read-only**: no create / update / delete wrappers
 * ship here. The orchestrator brief scopes this PR to the list
 * + detail flows only; write operations land in a later slice
 * once the deportes write endpoints ship.
 */

/** Wire DTO for a discipline option shared with dues pricing. */
export interface DisciplinaOption {
  id: string
  codigo: string
  nombre: string
}

/** Wire DTO for one row of the padron (one inscripcion). */
export interface PadronRow {
  /** UUID of the inscripcion record itself. */
  inscripcionId: string
  /** UUID of the socio enrolled in the padron. */
  socioId: string
  /** Operator-facing socio number, e.g. "00001". */
  numeroSocio: string
  nombre: string
  apellido: string
  /** DNI as 7–8 digit string. */
  dni: string
  /** Inscripcion lifecycle: 'activa' | 'baja' | 'pendiente'. */
  estado: string
  /** YYYY-MM-DD when the socio joined this padron. */
  fechaAlta: string
  /** Stable codigo (e.g. 'NATACION') — also the URL filter. */
  disciplinaCodigo: string
  /** Display name (e.g. 'Natación'). */
  disciplinaNombre: string
  ejercicioAnio: number
}

/** Wire shape of `GET /api/v1/padrones`. */
export interface PadronListResponse {
  disciplina: string
  ejercicio: number
  items: PadronRow[]
  page: number
  limit: number
  total: number
  has_more: boolean
}

/** Required + optional params for `GET /api/v1/padrones`. */
export interface PadronListParams {
  /** Disciplina codigo (e.g. 'NATACION'). Required. */
  disciplina: string
  /** Ejercicio year (e.g. 2026). Required. */
  ejercicio: number
  /** Page number — server defaults to 1. */
  page?: number
  /** Page size — server defaults to 50, max 200. */
  limit?: number
}

/** Load the discipline catalog used by padrones and dues pricing. */
export function getDisciplinas(): Promise<{ items: DisciplinaOption[] }> {
  return apiFetch<{ items: DisciplinaOption[] }>('/api/v1/padrones/disciplinas', {
    query: {},
  })
}

/**
 * `getPadrones(params)` — paginated padron roster for one
 * disciplina + ejercicio. Returns the filtered list of
 * `PadronRow` plus the pagination metadata the page needs
 * to render the Anterior / Siguiente controls.
 *
 * Throws `ApiError(400)` if either `disciplina` or `ejercicio`
 * is empty (server validates both as required), or
 * `ApiError(404)` if the disciplina/ejercicio combo doesn't
 * exist (no rows registered).
 */
export function getPadrones(params: PadronListParams): Promise<PadronListResponse> {
  return apiFetch<PadronListResponse>('/api/v1/padrones', {
    query: { ...params },
  })
}
