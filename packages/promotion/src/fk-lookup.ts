/**
 * buildFkMap — bulk load FK targets into an in-memory Map for O(1) per-row lookup.
 *
 * Pattern: ONE SELECT per domain → in-memory Map. Avoids N round-trips
 * where N = number of rows being promoted.
 *
 * For ctacte: loads `socios.id` keyed by `socios.numeroSocio` (master table).
 * For ctacte1: additionally loads `ctacte.id` keyed by `entity_uuids.source_key`
 *   (which IS the parent ctacte's CCTCUENTA value — verified 2026-06-24).
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

  // For ctacte1, also build ctacte CCTCUENTA → uuid map
  if (domain === 'ctacte1') {
    // ctacte master has no legacy_id column in E1a.
    // entity_uuids.source_key IS the CCTCUENTA value (verified 8,870 of 8,870
    // entity_uuids rows for ctacte match projection payload.CCTCUENTA exactly).
    // entity_uuid IS the ctacte master row's UUID (set when the row was created).
    const rows = await db.execute<{ id: string; cctcuenta: string }>(sql`
      SELECT c.id, e.source_key AS cctcuenta
      FROM "tesoreria"."ctacte" c
      JOIN "public"."entity_uuids" e ON e.source_table = 'ctacte' AND e.entity_uuid = c.id
    `)
    for (const r of rows.rows ?? []) map.set(`ctacte:${r.cctcuenta}`, r.id)
  }

  return {
    get: (key: string) => map.get(key),
  }
}
