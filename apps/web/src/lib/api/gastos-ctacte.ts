import { apiFetch } from '@/lib/api'

/**
 * Gastos ↔ Ctacte mapping API wrappers (TASK-010, PR n16b-web).
 *
 * Six ADMIN-only endpoints from `apps/api/src/routes/admin/gastos-ctacte.ts`
 * (shipped in v0.5.19). wire shapes mirror the route DTOs verbatim:
 *
 *   - `LinkDTO` for the gasto → ctacte link CRUD
 *   - `GastoLinkForCuenta` (joined) for the ctacte → gastos listing
 *   - `HeuristicCandidate` for the never-auto-persist heuristic discovery
 */

export type Motivo = 'manual' | 'heuristic-pending' | 'auto'

export interface GastosLink {
  id: string
  gastoId: string
  ctacteId: string
  montoCubierto: string
  motivo: Motivo
  anulado: boolean
  anuladoAt: string | null
  anuladoMotivo: string | null
  createdBy: string | null
  createdAt: string
}

export interface GastoLinkForCuenta {
  linkId: string
  gastoId: string
  ctacteId: string
  montoCubierto: string
  motivo: Motivo
  anulado: boolean
  gastoFecha: string
  gastoImporte: string
  gastoConcepto: string | null
  gastoCuentaPrincipal: string
}

export interface HeuristicCandidate {
  ctacteId: string
  socioId: string | null
  ctacteFecha: string
  ctacteConcepto: string | null
  debe: string
  haber: string
  daysDiff: number
  amountDiff: number
  score: number
  motivo: Motivo
}

/** GET /api/v1/gastos/:id/ctacte-links */
export function getGastoLinks(
  gastoId: string,
  activeOnly = false,
): Promise<{ items: GastosLink[] }> {
  return apiFetch<{ items: GastosLink[] }>('/api/v1/gastos/' + gastoId + '/ctacte-links', {
    query: activeOnly ? { active: 'true' } : {},
  })
}

/** POST /api/v1/gastos/:id/ctacte-links (409 on active duplicate, 400 on monto_exceeds) */
export function createLink(
  gastoId: string,
  input: { ctacteId: string; montoCubierto: string; motivo: Motivo },
): Promise<GastosLink> {
  return apiFetch<GastosLink>('/api/v1/gastos/' + gastoId + '/ctacte-links', {
    method: 'POST',
    body: {
      ctacte_id: input.ctacteId,
      monto_cubierto: input.montoCubierto,
      motivo: input.motivo,
    },
  })
}

/** DELETE /api/v1/gastos-ctacte-links/:linkId (hard remove) */
export function deleteLink(linkId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/v1/gastos-ctacte-links/' + linkId, { method: 'DELETE' })
}

/** PATCH /api/v1/gastos-ctacte-links/:linkId/anular (soft; re-link allowed) */
export function anularLink(linkId: string, motivo: string): Promise<GastosLink> {
  return apiFetch<GastosLink>('/api/v1/gastos-ctacte-links/' + linkId + '/anular', {
    method: 'PATCH',
    body: { motivo },
  })
}

/** GET /api/v1/ctacte/:cuenta/gastos-links — joined: gastos by ctacte cuenta */
export function getCtacteGastosLinks(cuenta: string): Promise<{ items: GastoLinkForCuenta[] }> {
  return apiFetch<{ items: GastoLinkForCuenta[] }>('/api/v1/ctacte/' + cuenta + '/gastos-links', {
    query: {},
  })
}

/** GET /api/v1/admin/gastos-ctacte-candidates — heuristic, NEVER auto-persists */
export function getCandidates(
  gastoId: string,
  limit = 50,
): Promise<{ items: HeuristicCandidate[] }> {
  return apiFetch<{ items: HeuristicCandidate[] }>('/api/v1/admin/gastos-ctacte-candidates', {
    query: { gasto_id: gastoId, limit },
  })
}
