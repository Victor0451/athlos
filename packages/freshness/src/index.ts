/**
 * @athlos/freshness — freshness monitoring.
 *
 * Provides:
 *   - `DOMAIN_THRESHOLDS` — per-domain staleness thresholds
 *   - `ageToStatus` — maps age in ms to 'current' | 'stale' | 'unknown'
 *   - `ageDisplay` — Spanish human-readable age ("hace 5 min")
 *   - `getFreshness` — reads domain_freshness cache and computes status
 */
export { DOMAIN_THRESHOLDS, ageToStatus, ageDisplay } from './thresholds.js'
export type { DomainFreshnessStatus } from './thresholds.js'
export { getFreshness, refreshAll, type DomainFreshness, type RefreshResult } from './api.js'
