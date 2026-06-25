/**
 * @athlos/promotion — public API.
 *
 * Exports the promotion algorithm, domain constants, FK lookup, dedup utilities,
 * and transform helpers for the projection-to-master promotion pipeline.
 */
export { promoteDomain, promoteAll, type Domain, type PromotionResult } from './promote.ts'
export {
  PROMOTION_ORDER,
  FK_BLOCKING_DOMAINS,
  PROJECTION_TABLE,
  DOMAIN_TRANSFORMS,
  type TransformFn,
} from './PROMOTION_ORDER.ts'
export { buildFkMap } from './fk-lookup.ts'
export { loadExistingNaturalKeys, naturalKey, type Domain as DedupDomain } from './dedup.ts'
export {
  parseFechaVFP,
  parseMonto,
  splitDebeHaber,
  splitApellidoNombre,
  type TransformHelpers,
  type FkMap,
} from './transform-helpers.ts'
export { transformEscuela } from './transforms/escuela.ts'
export { transformDeportes } from './transforms/deportes.ts'
export { transformLocacion } from './transforms/locacion.ts'
export { transformCaja } from './transforms/caja.ts'
