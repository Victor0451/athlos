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
  /**
   * Sort column. Mirrors the backend's `sortBy` enum (snake_case on
   * the wire). When omitted, the backend applies the default
   * `apellido ASC` order.
   */
  sortBy?: 'apellido' | 'nombre' | 'numero_socio' | 'dni' | 'fecha_alta' | 'estado'
  /** `asc` (default) or `desc`. */
  sortDir?: 'asc' | 'desc'
}

/** Wire shape of `GET /api/v1/socios?aggregate=1`. */
export interface SocioAggregate {
  activos: number
  suspendidos: number
  baja: number
  total: number
}

/**
 * `getSocios(params?)` — paginated list of socios. The backend caps
 * `limit` at 100 (default 20). The `search` filter is
 * case-insensitive on `nombre + apellido + dni`. The optional
 * `sortBy` / `sortDir` flow through to the wire (`sortBy=apellido&sortDir=asc`).
 */
export function getSocios(params: SocioListParams = {}): Promise<SocioListResponse> {
  return apiFetch<SocioListResponse>('/api/v1/socios', {
    query: { ...params },
  })
}

/**
 * `getSociosAggregate()` — count of socios per estado + total, fetched
 * in a single round-trip. Drives the summary cards on the Socios
 * list page (`PR 8b.2 second slice`). Returns `{ activos, suspendidos,
 * baja, total }`.
 */
export function getSociosAggregate(): Promise<SocioAggregate> {
  return apiFetch<SocioAggregate>('/api/v1/socios', { query: { aggregate: '1' } })
}

/**
 * `getSocio(id)` — single socio by UUID. Throws `ApiError(404)` if
 * the id is unknown, otherwise returns the wire DTO.
 */
export function getSocio(id: string): Promise<Socio> {
  return apiFetch<Socio>('/api/v1/socios/' + id, { query: {} })
}

/* ── Write surface (PR 8b.2, 2026-07-02) ────────────────────────────── */

/** Input shape for `createSocio`. Mirrors the backend's
 *  `createBodySchema` (`apps/api/src/routes/socios.ts:37`). Optional
 *  fields are omitted from the wire payload (apiFetch serialises
 *  `undefined` as "not sent" via the buildUrl helper). */
export interface CreateSocioInput {
  numero_socio: string
  nombre: string
  apellido: string
  dni: string
  /** YYYY-MM-DD */
  fecha_alta: string
  estado?: 'activo' | 'suspendido' | 'baja'
  categoria?: string
  direccion?: string
  telefono?: string
  email?: string
}

/** PATCH payload for `updateSocio`. `numero_socio` and `fecha_alta` are
 *  intentionally immutable (legacy business keys per backend's
 *  `updateBodySchema`). Backend enforces `.strict()` and "≥1 field"
 *  — we mirror that constraint in the form (no empty submits). */
export type UpdateSocioInput = Partial<Omit<CreateSocioInput, 'numero_socio' | 'fecha_alta'>>

/** `createSocio(input)` — POST /api/v1/socios (ADMIN only). Returns the
 *  newly created socio (HTTP 201 → mapped to 200 by the apiFetch
 *  status check). Throws `ApiError(409 CONFLICT)` if `numero_socio` or
 *  `dni` collides with an existing row. */
export async function createSocio(input: CreateSocioInput): Promise<Socio> {
  return apiFetch<Socio>('/api/v1/socios', { method: 'POST', body: input })
}

/** `updateSocio(id, patch)` — PATCH /api/v1/socios/:id (ADMIN only).
 *  Backend enforces ≥1 field via Zod `.refine`. */
export async function updateSocio(id: string, patch: UpdateSocioInput): Promise<Socio> {
  return apiFetch<Socio>('/api/v1/socios/' + id, { method: 'PATCH', body: patch })
}

/** `deleteSocio(id)` — DELETE /api/v1/socios/:id (ADMIN only).
 *  Soft-delete on the server: returns the updated row with
 *  `estado: 'baja'` and `deleted_at: ISO`. Throws `ApiError(404)` for
 *  unknown / cross-operator ids (the two cases are intentionally
 *  indistinguishable to avoid leaking row existence). */
export async function deleteSocio(id: string): Promise<Socio> {
  return apiFetch<Socio>('/api/v1/socios/' + id, { method: 'DELETE' })
}
