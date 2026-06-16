import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Dbf } from 'dbf-reader/dbf'
import type { DataTable } from 'dbf-reader/models/dbf-file'
import type { LegacyTableName } from '@athlos/integrations-legacy-db'

/**
 * A single legacy record, generic across the 14 tables.
 *
 * The legacy schema has ~50 different column shapes across the 14
 * tables — we keep the row as `Record<string, unknown>` so the
 * import pipeline can apply the typed shape per table downstream
 * (TASK-053, TASK-056).
 *
 * `legacyKey` is the VFP primary-key field for the row. The column
 * name varies per table (`NUMERO` for `socios`, `CODIGO` for
 * `catastros`, etc.) — the pipeline looks it up per table.
 */
export type LegacyRecord = Record<string, unknown> & { legacyKey: string }

/**
 * Read every row in a legacy table, one at a time, as an async iterable.
 *
 * Used by the import pipeline (`@athlos/import.runImport`) and the
 * bridge validator (`@athlos/import.validateBridges`). Production
 * reads the .DBF file from disk via the `dbf-reader` package;
 * tests inject the `LegacyDb` stub from `@athlos/integrations-legacy-db`
 * via {@link readTableFromStub}.
 *
 * The async iterable is intentionally flat — no batch window, no
 * backpressure. The pipeline pulls one row at a time to keep memory
 * bounded on the 325K-row `ctacte` table.
 */
export async function* readTable(
  name: LegacyTableName,
  basePath: string,
): AsyncIterable<LegacyRecord> {
  const filePath = join(basePath, `${name.toUpperCase()}.DBF`)
  const data = await readDbfFile(filePath)
  for (const row of data.rows) {
    yield normalizeRow(row, name)
  }
}

/**
 * Test seam: stream rows from an in-memory `DataTable` fixture. The
 * stub's `readTable` returns `Promise<DbfRow[]>` (the production
 * contract for the integrations package); we adapt it to the
 * `AsyncIterable<LegacyRecord>` shape the pipeline expects.
 */
export async function* readTableFromTable(
  name: LegacyTableName,
  table: DataTable,
): AsyncIterable<LegacyRecord> {
  for (const row of table.rows) {
    yield normalizeRow(row, name)
  }
}

/**
 * Read a DBF file from disk, surfacing filesystem errors as
 * `LEGACY_UNAVAILABLE`-style errors so the route layer can return 503.
 *
 * The `dbf-reader` library throws on malformed files, missing paths,
 * and unsupported encodings; we wrap to attach a uniform message
 * ("could not read <file>") so log filters can grep for the path.
 */
async function readDbfFile(filePath: string): Promise<DataTable> {
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`could not read legacy DBF file ${filePath}: ${reason}`)
  }
  try {
    return Dbf.read(buffer)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`could not parse legacy DBF file ${filePath}: ${reason}`)
  }
}

/**
 * Normalize a raw DBF row: strip trailing whitespace on string fields
 * (VFP pads with spaces) and assign a `legacyKey` so downstream
 * consumers don't have to know the per-table PK column name.
 *
 * The PK column name comes from {@link primaryKeyFor}. Adding a new
 * table is a one-line change there.
 */
function normalizeRow(raw: Record<string, unknown>, table: LegacyTableName): LegacyRecord {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    const trimmedK = k.trim().toUpperCase()
    out[trimmedK] = typeof v === 'string' ? v.trim() : v
  }
  // The VFP `legacyKey` column is sometimes stored as `LEGACY_KEY`,
  // sometimes as `LEGACYKEY` (no underscore — VFP strips underscores
  // in some column-name normalisation paths). We treat them as
  // equivalent and ALWAYS emit the canonical `LEGACY_KEY` form so
  // downstream consumers have one key to read.
  if (out['LEGACYKEY'] !== undefined && out['LEGACY_KEY'] === undefined) {
    out['LEGACY_KEY'] = out['LEGACYKEY']
    delete out['LEGACYKEY']
  } else if (out['LEGACYKEY'] !== undefined) {
    // Both were present — keep the underscored form, drop the bare.
    delete out['LEGACYKEY']
  }
  // Per-table PK resolution. If no explicit `LEGACY_KEY` was set,
  // resolve the conventional VFP primary-key column.
  if (out['LEGACY_KEY'] === undefined || out['LEGACY_KEY'] === null || out['LEGACY_KEY'] === '') {
    const pk = primaryKeyFor(out, table)
    if (pk) {
      out['LEGACY_KEY'] = pk
    } else {
      // No PK could be resolved — surface an empty key so the
      // pipeline can fail the row with a clear "missing legacyKey"
      // error rather than crashing.
      out['LEGACY_KEY'] = ''
    }
  }
  return out as LegacyRecord
}

/**
 * Pick the legacy primary-key column for a table. Each entry maps
 * the table to the VFP column that uniquely identifies a row.
 */
const TABLE_PK_COLUMN: Readonly<Record<LegacyTableName, string>> = {
  paramet: 'CODIGO',
  usuario: 'USUCLAVE',
  ctacte1: 'NROASIE',
  socios: 'NUMERO',
  ctacte: 'NROASIE',
  asiento: 'NUMCOMP',
  asientod: 'NUMCOMP',
  cobros: 'NUMCOMP',
  plancue: 'CODIGO',
  catastros: 'CODIGO',
  escuela: 'CODIGO',
  deportes: 'CODIGO',
  locacion: 'CODIGO',
  caja: 'NUMCOMP',
  gastos: 'NUMCOMP',
}

function primaryKeyFor(raw: Record<string, unknown>, table: LegacyTableName): string | null {
  const col = TABLE_PK_COLUMN[table]
  const v = raw[col]
  if (v === undefined || v === null || v === '') return null
  return String(v)
}
