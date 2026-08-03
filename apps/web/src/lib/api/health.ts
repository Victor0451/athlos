import { apiFetch } from '@/lib/api'

/**
 * Health + freshness API wrappers (TASK-014, PR 8a.3).
 *
 * These legacy wrappers are intentionally thin: they declare the
 * response types and route through the shared `apiFetch` client.
 * The ADMIN dashboard uses the bounded operational snapshot instead
 * of combining these endpoints with scheduler reads.
 *
 * `GET /health` is unauthenticated (the `apiFetch` request interceptor
 * checks for a token in module-scope memory and skips the header when
 * the operator is not yet logged in, so the dashboard can fetch health
 * while it is still rendering the auth gate — important for the
 * post-login ping that proves the API is reachable).
 *
 * `GET /api/v1/freshness` requires auth (the existing interceptor
 * adds the `Authorization: Bearer` header automatically).
 */

/** Shape of the JSON body returned by GET /health. */
export interface HealthResponse {
  status: string
  version: string
  /** Seconds since the API process started. */
  uptime: number
  /** ISO-8601 timestamp. */
  timestamp: string
}

/** One row in the freshness payload — one per domain (socios, ctacte, …). */
export interface FreshnessItem {
  domain: string
  row_count: number
  /** ISO-8601 timestamp of the last master-table refresh. */
  last_update: string
}

/** Shape of the JSON body returned by GET /api/v1/freshness. */
export interface FreshnessResponse {
  items: FreshnessItem[]
}

/**
 * `getHealth()` — liveness probe for the API. No auth, no DB call;
 * if the API process is running it responds 200 with the build
 * version and uptime.
 */
export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health')
}

/**
 * `getFreshness()` — per-domain master-table row counts + last
 * update timestamp. Drives the "Master Table Counts" card on the
 * dashboard. ADMIN also uses this indirectly through the freshness
 * strip on the scheduler page (PR 8c.1).
 */
export function getFreshness(): Promise<FreshnessResponse> {
  return apiFetch<FreshnessResponse>('/api/v1/freshness')
}
