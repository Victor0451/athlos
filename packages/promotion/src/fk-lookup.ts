/**
 * buildFkMap — bulk load FK targets into an in-memory Map for O(1) per-row lookup.
 *
 * Pattern: ONE SELECT per domain → in-memory Map. Avoids N round-trips
 * where N = number of rows being promoted.
 *
 * For ctacte: loads `socios.id` keyed by `socios.numeroSocio` (master table).
 * For ctacte1: additionally loads `ctacte.id` keyed by `tesoreria.ctacte.cctcuenta`
 *   (E1b1+ strategy — replaces the broken E1a entity_uuids JOIN).
 */
import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { socios } from '@athlos/db/schema'
import type { FkMap } from './transform-helpers.ts'

export async function buildFkMap(db: Db, domain: string): Promise<FkMap> {
  const map = new Map<string, string>()

  // Always load socio mapping if any downstream domain will need it
  if (domain === 'ctacte' || domain === 'ctacte1') {
    const rows = await db.select({ id: socios.id, numeroSocio: socios.numeroSocio }).from(socios)
    for (const r of rows) map.set(`socio:${r.numeroSocio}`, r.id)
  }

  // E1b1+: ctacte1 FK map via direct SELECT from the cctcuenta column.
  // entity_uuids JOIN (E1a strategy) yields 0 rows because entity_uuids is stale
  // (populated at import time before promotion assigned new UUIDs to master).
  // New strategy: direct SELECT DISTINCT ON to get lexicographically smallest
  // UUID per cctcuenta.
  if (domain === 'ctacte1') {
    const rows = await db.execute<{ cctcuenta: string; id: string }>(sql`
        SELECT DISTINCT ON (cctcuenta) cctcuenta, id
        FROM "tesoreria"."ctacte" c
        WHERE c.cctcuenta IS NOT NULL
        ORDER BY cctcuenta, id
      `)
    for (const r of rows.rows ?? []) map.set(`ctacte:${r.cctcuenta}`, r.id)
  }

  return {
    get: (key: string) => map.get(key),
  }
}
