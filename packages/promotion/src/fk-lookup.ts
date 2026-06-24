/**
 * buildFkMap — bulk load FK targets into an in-memory Map for O(1) per-row lookup.
 *
 * Pattern: ONE SELECT per domain → in-memory Map. Avoids N round-trips
 * where N = number of rows being promoted.
 *
 * For ctacte: loads `socios.id` keyed by `socios.numeroSocio`.
 * For ctacte1: additionally loads `ctacte.id` keyed by `CCTNUMERO` via
 * the entity_uuids → raw_events join chain (E1a has no legacy_id column on ctacte).
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

  // For ctacte1, also build ctacte natural-key → uuid map
  if (domain === 'ctacte1') {
    // ctacte master has no legacy_id column in E1a.
    // Build ctacte natural-key → uuid by joining ctacte → entity_uuids → raw_events.
    // raw_events.source_key for ctacte records IS the CCTNUMERO.
    const rows = await db.execute<{ id: string; cctnumero: string }>(sql`
      SELECT c.id, r.source_key AS cctnumero
      FROM "tesoreria"."ctacte" c
      JOIN "public"."entity_uuids" e ON e.source_table = 'ctacte' AND e.entity_uuid = c.id
      JOIN "public"."raw_events" r ON r.source_table = 'ctacte' AND r.source_key = e.source_key
    `)
    for (const r of rows.rows ?? []) map.set(`ctacte:${r.cctnumero}`, r.id)
  }

  return {
    get: (key: string) => map.get(key),
  }
}
