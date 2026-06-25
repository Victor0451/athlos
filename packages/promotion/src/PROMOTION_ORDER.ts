/**
 * PROMOTION_ORDER — topological sort of domains by FK dependency.
 *
 * socios (no FK) → ctacte (FK: socio_id → socios.id) → ctacte1 (FK: ctacte_id → ctacte.id)
 * escuela, deportes, locacion, caja are independent FK trees (no required FK in v1.0).
 *
 * E1b2a extends: escuela, deportes, locacion, caja (4 NEW independent domains).
 * E1b2b will add: gastos.
 */
import type { Domain } from './promote.ts'
import type { TransformHelpers } from './transform-helpers.ts'
import { transformSocio } from './transforms/socios.ts'
import { transformCtacte } from './transforms/ctacte.ts'
import { transformCtacte1 } from './transforms/ctacte1.ts'
import { transformEscuela } from './transforms/escuela.ts'
import { transformDeportes } from './transforms/deportes.ts'
import { transformLocacion } from './transforms/locacion.ts'
import { transformCaja } from './transforms/caja.ts'

export type { Domain }

export const PROMOTION_ORDER: readonly Domain[] = [
  'socios',
  'escuela',
  'deportes',
  'locacion',
  'caja',
  'ctacte',
  'ctacte1',
] as const

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
  escuela: { schema: 'public', table: 'socios.escuela_projection' },
  deportes: { schema: 'public', table: 'deportes.deportes_projection' },
  locacion: { schema: 'public', table: 'socios.locacion_projection' },
  caja: { schema: 'public', table: 'tesoreria.caja_projection' },
  ctacte: { schema: 'public', table: 'tesoreria.ctacte_projection' },
  ctacte1: { schema: 'public', table: 'tesoreria.ctacte1_projection' },
}

export type TransformFn = (payload: Record<string, unknown>, helpers: TransformHelpers) => unknown

export const DOMAIN_TRANSFORMS: Record<Domain, TransformFn> = {
  socios: transformSocio as TransformFn,
  escuela: transformEscuela as TransformFn,
  deportes: transformDeportes as TransformFn,
  locacion: transformLocacion as TransformFn,
  caja: transformCaja as TransformFn,
  ctacte: transformCtacte as TransformFn,
  ctacte1: transformCtacte1 as TransformFn,
}
