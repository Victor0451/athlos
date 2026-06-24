/**
 * PROMOTION_ORDER — topological sort of domains by FK dependency.
 *
 * socios (no FK) → ctacte (FK: socio_id → socios.id) → ctacte1 (FK: ctacte_id → ctacte.id)
 *
 * E1b will extend with: escuela, deportes, locacion, caja, gastos.
 */
import type { Domain } from './promote.ts'
import type { TransformHelpers } from './transform-helpers.ts'
import { transformSocio } from './transforms/socios.ts'
import { transformCtacte } from './transforms/ctacte.ts'
import { transformCtacte1 } from './transforms/ctacte1.ts'

export type { Domain }

export const PROMOTION_ORDER: readonly Domain[] = ['socios', 'ctacte', 'ctacte1'] as const

/** Domains whose failure (inserted=0 + failed>0) short-circuits downstream dependents. */
export const FK_BLOCKING_DOMAINS: readonly Domain[] = ['socios', 'ctacte']

/**
 * Map domain → projection table (schema-qualified).
 *
 * Projection tables live in the `public` schema with a literal dot in their
 * name (e.g. `public."socios.socios_projection"`). Stored as structured
 * schema + table to avoid ambiguity in the split (table names contain dots).
 */
export const PROJECTION_TABLE: Record<Domain, { schema: string; table: string }> = {
  socios: { schema: 'public', table: 'socios.socios_projection' },
  ctacte: { schema: 'public', table: 'tesoreria.ctacte_projection' },
  ctacte1: { schema: 'public', table: 'tesoreria.ctacte1_projection' },
}

export type TransformFn = (payload: Record<string, unknown>, helpers: TransformHelpers) => unknown

export const DOMAIN_TRANSFORMS: Record<Domain, TransformFn> = {
  socios: transformSocio as TransformFn,
  ctacte: transformCtacte as TransformFn,
  ctacte1: transformCtacte1 as TransformFn,
}
