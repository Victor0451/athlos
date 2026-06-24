import type { Db } from '@athlos/db'
import { ErrorCode, BusinessError } from '@athlos/errors'

export const DOMAIN_PROJECTION_TABLE = {
  socios: 'socios.socios_projection',
  ctacte: 'tesoreria.ctacte_projection',
  ctacte1: 'tesoreria.ctacte1_projection',
  contable: 'contabilidad.contable_projection',
  contabl1: 'contabilidad.contabl1_projection',
  catastros: 'socios.catastros_projection',
  escuela: 'socios.escuela_projection',
  deportes: 'deportes.deportes_projection',
  locacion: 'socios.locacion_projection',
  caja: 'tesoreria.caja_projection',
  gastos: 'tesoreria.gastos_projection',
} as const

export type Domain = keyof typeof DOMAIN_PROJECTION_TABLE

export interface RebuildResult {
  rowCount: number
  durationMs: number
}

/**
 * Truncate-then-replay a domain projection.
 *
 * Algorithm:
 *   1. Validate domain against DOMAIN_PROJECTION_TABLE → BusinessError(VALIDATION) if unknown
 *   2. TRUNCATE the target projection table
 *   3. SELECT all raw_events rows for this domain + JOIN entity_uuids to get entity_uuid
 *   4. INSERT into the projection table
 *
 * Idempotent: same raw_events content → same end state.
 */
export async function rebuildProjection(
  db: Db,
  domain: Domain,
  _opts: { batchSize?: number } = {},
): Promise<RebuildResult> {
  const table = DOMAIN_PROJECTION_TABLE[domain]
  if (!table) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, `Unknown domain: ${String(domain)}`, { domain })
  }

  const t0 = Date.now()

  // Ensure the projection table exists (idempotent — CREATE TABLE IF NOT EXISTS).
  // Mirrors raw_events schema so raw_events payloads replay directly.
  // Note: identifiers must be inlined (NOT parameterized) to avoid pg
  // treating the schema-qualified name as a positional placeholder ($1).
  const sqlCreate = `CREATE TABLE IF NOT EXISTS "${table}" (
      id uuid PRIMARY KEY,
      source_table varchar(32) NOT NULL,
      source_key varchar(64) NOT NULL,
      payload jsonb NOT NULL,
      imported_at timestamp with time zone NOT NULL DEFAULT now()
    )`
  await db.execute(sqlCreate)

  // Truncate the projection table
  await db.execute(`TRUNCATE TABLE "${table}"`)

  // Replay: SELECT raw_events, INSERT into projection.
  // (Removed JOIN to entity_uuids — that table is populated lazily by a
  // separate background job. The projection can use raw_events.id directly.)
  const replayResult = await db.execute(
    `INSERT INTO "${table}" (id, source_table, source_key, payload, imported_at) SELECT r.id, r.source_table, r.source_key, r.payload, r.imported_at FROM raw_events r WHERE r.source_table = '${domain}' ORDER BY r.imported_at ASC`,
  )

  return {
    rowCount: Number(replayResult.rowCount ?? 0),
    durationMs: Date.now() - t0,
  }
}
