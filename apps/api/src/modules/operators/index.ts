/**
 * Module barrel for apps/api/src/modules/operators/.
 *
 * Re-exports the public surface of the operator module so route files
 * can import listByIds, getOperatorByIdsQuerySchema, and OperatorSummary
 * from a stable path instead of drilling into the file directly.
 * Mirrors the pattern used by the package barrels under packages.
 *
 * Today the module has a single file (lookup.ts); this barrel exists
 * so the route layer import path stays stable as additional files
 * (for example schema.ts after a D3 split) get added.
 */

export { getOperatorByIdsQuerySchema, OperatorRole, type OperatorSummary } from './lookup.ts'
