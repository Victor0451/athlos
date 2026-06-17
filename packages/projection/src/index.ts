/**
 * @athlos/projection — public API.
 *
 * The projection engine. Provides:
 *   - `rebuildProjection` — truncate-then-replay for a domain
 *   - `computeSaldo` — compute saldo from CTACTE rows for a socio
 *   - `DOMAIN_PROJECTION_TABLE` — 11-domain map
 *
 * Exposes Domain type and SaldoResult.
 */

export { rebuildProjection, type Domain } from './rebuild.ts'
export { DOMAIN_PROJECTION_TABLE } from './rebuild.ts'
export { computeSaldo, type SaldoResult } from './saldo.ts'
