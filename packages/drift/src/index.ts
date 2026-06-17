/**
 * @athlos/drift — drift detection.
 *
 * Provides:
 *   - `detect` — compare latest raw_events hash against drift_snapshots
 *   - `emitDriftAlert` — direct Drizzle insert to audit_events + notification dispatch
 */
export { detect, type DriftReport } from './detect.js'
export { emitDriftAlert } from './alert.js'
