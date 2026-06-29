import { apiFetch } from '@/lib/api'

/**
 * Socios API wrappers (TASK-018, PR 8b.1).
 *
 * Read-only surface for PR 8b.1 — browse the 16,383 socio master
 * table. The DTO mirrors the wire shape from
 * `apps/api/src/routes/socios.ts` (snake_case: `numero_socio`,
 * `fecha_alta`, `created_at`, etc.) so the TypeScript types stay in
 * lock-step with the server response.
 *
 * No `create` / `update` / `delete` wrappers ship here — the
 * orchestrator scope for PR 8b.1 is **read-only**. The ADMIN role
 * gate is server-side (`requireRole('ADMIN')`); until we ship the
 * admin action surface (PR 8b.1b or 8b.2), the URL paths just don't
 * exist in the wrapper.
 *
 * Search behaviour (per backend `list()` + `socio.searchService`):
 * the `search` query param does a case-insensitive substring match
 * across `nombre + apellido + dni` server-side. The page renders
 * the input on the URL via nuqs (PR 8b.1 §TASK-022) so a search is
 * a normal `router.replace('/socios?search=garcia')` and the
 * query refetches.
 */

/** Wire DTO for one row in `GET /api/v1/socios` and `/socios/:id`. */
export interface Socio {
  id: string
  numero_socio: string
  nombre: string
  apellido: string
  dni: string
  /** YYYY-MM-DD. */
  fecha_alta: string
  estado: 'activo' | 'suspendido' | 'baja'
  categoria: string | null
  direccion: string | null
  telefono: string | null
  email: string | null
  /** ISO-8601 timestamp. */
  created_at: string
  /** ISO-8601 timestamp. */
  updated_at: string
  /** ISO-8601 timestamp or null if the socio is not soft-deleted. */
  deleted_at: string | null
}

/** Wire shape of `GET /api/v1/socios`. */
export interface SocioListResponse {
  items: Socio[]
  page: number
  limit: number
  total: number
  has_more: boolean
}

/** Optional filters / pagination for `GET /api/v1/socios`. */
export interface SocioListParams {
  page?: number
  limit?: number
  search?: string
  estado?: 'activo' | 'suspendido' | 'baja'
}

/**
 * `getSocios(params?)` — paginated list of socios. The backend caps
 * `limit` at 100 (default 20). The `search` filter is
 * case-insensitive on `nombre + apellido + dni`.
 */
export function getSocios(params: SocioListParams = {}): Promise<SocioListResponse> {
  return apiFetch<SocioListResponse>('/api/v1/socios', {
    query: { ...params },
  })
}

/**
 * `getSocio(id)` — single socio by UUID. Throws `ApiError(404)` if
 * the id is unknown, otherwise returns the wire DTO.
 */
export function getSocio(id: string): Promise<Socio> {
  return apiFetch<Socio>('/api/v1/socios/' + id, { query: {} })
}
