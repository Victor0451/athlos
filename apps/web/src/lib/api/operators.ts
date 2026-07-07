import { apiFetch } from '@/lib/api'

/**
 * Operator API wrappers (PR 8b.5 — `athlos-audit-operator-display`).
 *
 * Read-only batch lookup of operator summaries (`id`, `username`,
 * `role`) for the AuditTab and SocioNotesCard render surfaces. The
 * wire DTO mirrors the backend response from
 * `apps/api/src/routes/operators.ts` (PR 8b.5 backend slice, already
 * merged to main).
 *
 * No write surface: the operator CRUD lives on
 * `/api/v1/admin/operators/:id` and is gated server-side by
 * `requireRole('ADMIN')`. The chip helper only needs the public
 * summary.
 *
 * Cache key (locked decision, design D8): both AuditTab and
 * SocioNotesCard share a TanStack Query entry keyed on the sorted,
 * comma-joined id list. The sort happens at the call site — the
 * wrapper itself takes ids in any order.
 */

/** Wire DTO for one row in `GET /api/v1/operators`. */
export type OperatorRole = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'

export interface OperatorSummary {
  id: string
  username: string
  role: OperatorRole
}

/** Wire shape of `GET /api/v1/operators`. */
interface OperatorsListResponse {
  operators: OperatorSummary[]
}

/**
 * Deterministic TanStack Query key for a batch lookup. Sorts the ids
 * lexicographically before joining so two consumers feeding the same
 * set in different orders produce the same key (spec
 * §"Deterministic key").
 */
export const OPERATORS_QUERY_KEY = (sortedIds: readonly string[]) =>
  ['operators', sortedIds.join(',')] as const

/**
 * `getOperatorNames(ids)` — GET /api/v1/operators?ids=...
 *
 * Returns the unwrapped `operators` array. The backend caps the
 * batch at 200 ids (Zod `.max(200)`); over-cap calls throw
 * `ApiError(400 VALIDATION_ERROR)` via `apiFetch`.
 *
 * Empty input short-circuits to `[]` so the consumer doesn't issue
 * a meaningless network roundtrip; this matches the repository-side
 * short-circuit in `apps/api/src/modules/operators/lookup.ts`.
 */
export async function getOperatorNames(ids: readonly string[]): Promise<OperatorSummary[]> {
  if (ids.length === 0) return []
  const res = await apiFetch<OperatorsListResponse>('/api/v1/operators?ids=' + ids.join(','), {
    query: {},
  })
  return res.operators ?? []
}
