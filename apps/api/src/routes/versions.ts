import type { FastifyPluginAsync } from 'fastify'
import type { Pool } from 'pg'
import { createHash } from 'node:crypto'

/**
 * Version discovery endpoint — `GET /api/versions`.
 *
 * Returns the runtime fingerprint the web app uses to detect
 * stale-cache reloads, the deployment track, and the DB migration
 * level. The endpoint is intentionally unversioned (NOT
 * `/api/v1/versions`) — a client that has never spoken to the API
 * should be able to learn the version list without first knowing
 * the version prefix exists.
 *
 * Body:
 *   {
 *     api: '1.0.0',          // from package.json
 *     db: '<7-char hash>',   // sha256(migrationCount + lastMigration)
 *                            // truncated to 7 chars (git-short style)
 *     node: 'v22.x.x',       // process.version
 *     build: '<sha>' | 'dev' // BUILD_SHA passed in as a dep
 *   }
 *
 * The DB hash is computed lazily on each request — it's a single
 * `SELECT count(*), max(id) FROM __drizzle_migrations` which is
 * cheap (indexed scan, ~1ms) and avoids a cache-invalidation
 * problem on migration runs.
 *
 * The 7-char truncation is purely cosmetic — it gives the
 * Prometheus / `?v=<hash>` cache-buster a stable, short token.
 */
export interface VersionsDeps {
  pool: Pool
  /** API version from package.json. */
  version: string
  /** Build SHA from CI; defaults to 'dev' in local. */
  buildSha: string
}

interface VersionDiscoveryResponse {
  api: string
  db: string
  node: string
  build: string
}

export const versionsRoutes: FastifyPluginAsync<VersionsDeps> = async (
  fastify,
  { pool, version, buildSha },
) => {
  fastify.get('/api/versions', async (): Promise<VersionDiscoveryResponse> => {
    let dbHash = 'unknown'
    try {
      // Drizzle's `__drizzle_migrations` table holds one row per
      // applied migration. The hash mixes count + last id so a
      // re-apply (no-op) doesn't change the fingerprint, but a new
      // migration does.
      const result = await pool.query<{ count: string; last: number | null }>(
        'SELECT count(*)::text as count, max(id) as last FROM __drizzle_migrations',
      )
      const row = result.rows[0]
      const count = row?.count ?? '0'
      const last = row?.last ?? 0
      dbHash = createHash('sha256').update(`${count}:${last}`).digest('hex').slice(0, 7)
    } catch {
      // The migration table may not exist in test env (no migrations
      // applied). Fall back to a deterministic "no-migrations" token
      // so the endpoint still returns a 200.
      dbHash = 'nomig__'
    }
    return {
      api: version,
      db: dbHash,
      node: process.version,
      build: buildSha,
    }
  })
}
