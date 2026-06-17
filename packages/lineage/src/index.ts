/**
 * @athlos/lineage — public API.
 *
 * The lineage tracker. Provides:
 *   - `queryLineage` — look up the full import chain for a UUID entity
 *   - `verifyHash` — recompute SHA-256 from raw_events.payload and compare to stored hash
 *
 * Exposes the 5-field LineageResponse shape and HashVerificationResult.
 */

// Re-export public functions
export { queryLineage } from './query.ts'
export { verifyHash } from './verify.ts'

// Types barreled from query.ts
export type { LineageResponse } from './query.ts'
export type { HashVerificationResult } from './verify.ts'
