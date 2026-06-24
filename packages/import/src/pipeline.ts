import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Dbf } from 'dbf-reader/dbf'
import { and, eq } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { entityUuids, rawEvents, type NewRawEvent } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { LegacyTableName } from '@athlos/integrations-legacy-db'
import type { DataTable } from 'dbf-reader/models/dbf-file'
import { readTableFromTable, type LegacyRecord } from './dbf-reader.ts'
import { computeHash } from './hash.ts'

/**
 * A single import run. `id` is the value stored in `raw_events.import_batch`
 * (matches `job_runs.id` when triggered by the scheduled job).
 *
 * `trigger` is who kicked the run off:
 *   - `'manual'`  — admin endpoint (`POST /api/v1/import/trigger`)
 *   - `'scheduled'` — nightly cron (`scheduled-import` job)
 */
export interface ImportBatch {
  id: string
  trigger: 'manual' | 'scheduled'
  startedAt: Date
  finishedAt: Date | null
  status: 'running' | 'succeeded' | 'failed'
  tables: ImportTableSummary[]
  totals: { read: number; inserted: number; skipped: number; failed: number }
  errorMessage: string | null
}

/**
 * Per-table summary. Mirrors the `tables` array in the design's
 * `IMPORT_BATCH_COMPLETED` log entry so the admin history endpoint
 * (PR 7c) can render the result without re-querying `raw_events`.
 */
export interface ImportTableSummary {
  table: LegacyTableName
  recordsRead: number
  recordsInserted: number
  recordsSkipped: number
  recordsFailed: number
  durationMs: number
  errorMessage: string | null
}

/**
 * The 14 legacy tables in mandatory dependency order. Mirrors the
 * spec's `paramet → tipocomp → SECUENCI → catálogos → socios →
 * escuela → deportes → locacion → CTACTE → CTACTE1 → CONTABLE →
 * CONTABL1 → CAJA → GASTOS` order, mapped to the
 * `@athlos/integrations-legacy-db` table names. `usuario` is
 * imported by TASK-023 (PR 3b, `migrate-usuario.ts`) and is NOT
 * part of the 14 — the pipeline does not touch it.
 *
 * The order is enforced by {@link runImport} — `CTACTE1` cannot be
 * imported before `CTACTE`, `ASIENTOD` cannot be imported before
 * `ASIENTO`, etc. The dependency is the legacy VFP lookup, not a
 * Drizzle FK (the legacy data is loaded into the append-only
 * `raw_events` store, not into the projection tables).
 */
export const LEGACY_IMPORT_ORDER: readonly LegacyTableName[] = [
  'paramet',
  'socios',
  'ctacte',
  'ctacte1',
  'asiento',
  'asientod',
  'cobros',
  'plancue',
  'catastros',
  'escuela',
  'deportes',
  'locacion',
  'caja',
  'gastos',
] as const

/**
 * The pair of dependencies each table has. A table is importable only
 * after every entry in `dependsOn` has been imported in the same
 * batch OR be present in `raw_events` from a previous batch.
 *
 * `paramet` is the root of the DAG (no dependencies). `ctacte1`
 * depends on `ctacte` because the CTACTE1 sub-ledger is meaningless
 * without the parent CTACTE row loaded first; same for
 * `asientod → asiento`. Everything else is flat. `usuario` is
 * listed (without dependencies) so the map covers the full
 * `LegacyTableName` union; the import pipeline never iterates
 * over it.
 */
export const TABLE_DEPENDENCIES: Readonly<Record<LegacyTableName, readonly LegacyTableName[]>> = {
  paramet: [],
  usuario: [],
  ctacte1: ['ctacte'],
  socios: [],
  ctacte: [],
  asiento: [],
  asientod: ['asiento'],
  cobros: [],
  plancue: [],
  catastros: [],
  escuela: [],
  deportes: [],
  locacion: [],
  caja: [],
  gastos: [],
}

/**
 * Options for {@link runImport}.
 *
 * - `tables` — when set, import only these tables (must appear in
 *   {@link LEGACY_IMPORT_ORDER}). Default: all 14.
 * - `basePath` — path containing the 14 .DBF files (production).
 *   When set, the pipeline reads from disk via `dbf-reader`.
 * - `fixtures` — in-memory `DataTable` per table (tests + smoke).
 *   When set, takes precedence over `basePath` for the named table.
 * - `batchId` — override the generated batch UUID (the admin
 *   endpoint uses this to align with `job_runs.id`).
 */
export interface RunImportOptions {
  trigger: 'manual' | 'scheduled'
  tables?: readonly LegacyTableName[]
  basePath?: string
  fixtures?: Partial<Record<LegacyTableName, DataTable>>
  batchId?: string
}

/**
 * Run the import pipeline end-to-end.
 *
 * Algorithm:
 *   1. Resolve the batch id + ordered table list.
 *   2. For each table (in dependency order):
 *      a. Stream rows (fixtures → on-disk DBF → empty).
 *      b. Compute the content hash for each row.
 *      c. Insert into `raw_events` with
 *         `ON CONFLICT (source_table, source_key, content_hash) DO NOTHING`.
 *      d. Aggregate per-table counts.
 *   3. Return the {@link ImportBatch} summary.
 *
 * The pipeline is **append-only** — re-running with identical content
 * is a no-op (`ON CONFLICT DO NOTHING` skips the insert, the row
 * count is preserved in `recordsSkipped`). Re-running with changed
 * content appends a new `raw_events` row, preserving history
 * (the spec's "Hash-Based Change Detection → Modified record"
 * scenario).
 *
 * The bridge validator (`validateBridges`) is NOT called here —
 * callers chain it after `runImport` returns. Splitting the two keeps
 * the import idempotent (a partial-import batch can be re-run without
 * re-firing orphan alerts).
 */
export async function runImport(db: Db, opts: RunImportOptions): Promise<ImportBatch> {
  const batchId = opts.batchId ?? crypto.randomUUID()
  const tables = resolveTableList(opts.tables)
  const startedAt = new Date()

  // Track which tables have been imported in THIS batch so the
  // dependency check is satisfied (vs. relying on a previous batch).
  const importedInThisBatch = new Set<LegacyTableName>()
  const summaries: ImportTableSummary[] = []
  let totalRead = 0
  let totalInserted = 0
  let totalSkipped = 0
  let totalFailed = 0
  let firstError: string | null = null

  for (const table of tables) {
    // Dependency check: every prerequisite must have been imported
    // in this batch OR (for re-runs) be present in raw_events. The
    // spec's "CTACTE1 imported before CTACTE" scenario aborts here.
    const deps = TABLE_DEPENDENCIES[table]
    for (const dep of deps) {
      if (importedInThisBatch.has(dep)) continue
      const present = await hasAnyEvent(db, dep)
      if (!present) {
        const msg = `${table} requires ${dep} to be imported first`
        throw BusinessError(ErrorCode.INTERNAL_ERROR, msg, {
          batchId,
          table,
          missingDependency: dep,
        })
      }
    }

    const tableStart = Date.now()
    const summary: ImportTableSummary = {
      table,
      recordsRead: 0,
      recordsInserted: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      durationMs: 0,
      errorMessage: null,
    }
    summaries.push(summary)

    // Batched insert buffer — flush every BATCH_SIZE rows (or at table end).
    // One multi-row INSERT with ON CONFLICT DO NOTHING is ~50x faster than
    // single-row INSERTs on the 325k-row ctacte table.
    let buffer: NewRawEvent[] = []
    const BATCH_SIZE = 1000
    const flush = async () => {
      if (buffer.length === 0) return
      try {
        const insertedCount = await insertRawEventBatch(db, buffer)
        summary.recordsInserted += insertedCount
        summary.recordsSkipped += buffer.length - insertedCount
        totalInserted += insertedCount
        totalSkipped += buffer.length - insertedCount
      } catch (err) {
        const batchErr = err instanceof Error ? err.message : String(err)
        // Fallback: try one-by-one to identify the bad row
        for (const row of buffer) {
          try {
            const ok = await insertRawEvent(db, row)
            if (ok) {
              summary.recordsInserted += 1
              totalInserted += 1
            } else {
              summary.recordsSkipped += 1
              totalSkipped += 1
            }
          } catch (innerErr) {
            summary.recordsFailed += 1
            totalFailed += 1
            const reason = innerErr instanceof Error ? innerErr.message : String(innerErr)
            if (summary.errorMessage === null) {
              summary.errorMessage = `${batchErr.slice(0, 60)} | row ${row.sourceTable}:${row.sourceKey}: ${reason}`
            }
            if (firstError === null) firstError = reason
            console.error('[import] failed row:', row.sourceTable, row.sourceKey, reason)
          }
        }
      }
      buffer = []
    }

    for await (const record of streamTable(table, opts)) {
      summary.recordsRead += 1
      totalRead += 1
      try {
        const legacyKey = String(record['LEGACY_KEY'] ?? '')
        if (!legacyKey) {
          summary.recordsFailed += 1
          totalFailed += 1
          summary.errorMessage = `row missing legacyKey in ${table}`
          if (firstError === null) firstError = summary.errorMessage
          continue
        }
        const payload = stripLegacyKey(record)
        const hash = computeHash(payload)
        buffer.push({
          sourceTable: table,
          sourceKey: legacyKey,
          contentHash: hash,
          payload,
          importBatch: batchId,
        })
        if (buffer.length >= BATCH_SIZE) {
          await flush()
        }
      } catch (err) {
        summary.recordsFailed += 1
        totalFailed += 1
        const reason = err instanceof Error ? err.message : String(err)
        summary.errorMessage = reason
        if (firstError === null) firstError = reason
      }
    }
    // Flush remaining rows at end of table
    await flush()
    summary.durationMs = Date.now() - tableStart
    importedInThisBatch.add(table)
  }

  return {
    id: batchId,
    trigger: opts.trigger,
    startedAt,
    finishedAt: new Date(),
    status: firstError === null ? 'succeeded' : 'failed',
    tables: summaries,
    totals: {
      read: totalRead,
      inserted: totalInserted,
      skipped: totalSkipped,
      failed: totalFailed,
    },
    errorMessage: firstError,
  }
}

function resolveTableList(
  override: readonly LegacyTableName[] | undefined,
): readonly LegacyTableName[] {
  if (!override || override.length === 0) return LEGACY_IMPORT_ORDER
  // Validate: every entry must be in the canonical order. Reject
  // out-of-order lists so a caller can't accidentally import
  // CTACTE1 before CTACTE.
  let lastIdx = -1
  for (const t of override) {
    const idx = LEGACY_IMPORT_ORDER.indexOf(t)
    if (idx === -1) {
      throw BusinessError(ErrorCode.INTERNAL_ERROR, `unknown legacy table: ${String(t)}`, {
        table: String(t),
      })
    }
    if (idx < lastIdx) {
      throw BusinessError(
        ErrorCode.INTERNAL_ERROR,
        `import order violation: ${t} listed before its dependency`,
        { table: t, lastIdx, idx },
      )
    }
    lastIdx = idx
  }
  return override
}

/**
 * Stream rows for a table, picking the right source:
 *   1. `fixtures[table]` — in-memory `DataTable` (tests + smoke).
 *   2. `basePath` — on-disk DBF file via `dbf-reader` (production).
 *   3. Empty stream — caller forgot to wire a source (smoke).
 */
async function* streamTable(
  table: LegacyTableName,
  opts: RunImportOptions,
): AsyncIterable<LegacyRecord> {
  if (opts.fixtures && opts.fixtures[table]) {
    yield* readTableFromTable(table, opts.fixtures[table]!)
    return
  }
  if (opts.basePath) {
    yield* readTableFromDisk(table, opts.basePath)
    return
  }
  // No source configured — emit nothing. Callers who pass neither
  // are dev-time smoke tests; the totals will all be zero.
}

async function* readTableFromDisk(
  table: LegacyTableName,
  basePath: string,
): AsyncIterable<LegacyRecord> {
  const filePath = join(basePath, `${table.toUpperCase()}.DBF`)
  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw BusinessError(
      ErrorCode.SERVICE_UNAVAILABLE,
      `could not read legacy DBF file ${filePath}: ${reason}`,
      { filePath, table },
    )
  }
  let data: DataTable
  try {
    data = Dbf.read(buffer)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw BusinessError(
      ErrorCode.SERVICE_UNAVAILABLE,
      `could not parse legacy DBF file ${filePath}: ${reason}`,
      { filePath, table },
    )
  }
  for (const row of data.rows) {
    yield normalizeDbfRow(row as Record<string, unknown>)
  }
}

/**
 * Convert a raw `Dbf.read` row into a {@link LegacyRecord}: trim
 * string fields (VFP pads with spaces) and resolve the legacy key
 * from the conventional PK column.
 *
 * Real DBF column names from the production legacy data (Gorriti
 * club, AplicacionGorriti). VFP stores columns with the table name
 * as a prefix — e.g. PARAMET.PARCODIGO, SOCIOS.SOCCARNET.
 */
function normalizeDbfRow(row: Record<string, unknown>): LegacyRecord {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    const trimmedK = k.trim().toUpperCase()
    out[trimmedK] = typeof v === 'string' ? v.trim() : v
  }
  const legacyKey =
    firstNonEmpty([
      // Common VFP PK column names
      out['LEGACY_KEY'],
      out['NUMERO'],
      out['CODIGO'],
      out['NUMCOMP'],
      out['NROASIE'],
      out['ID'],
      out['CLAVE'],
      out['USUCLAVE'],
      // Real legacy DBF columns from Gorriti (AplicacionGorriti)
      out['PARCODIGO'],
      out['SOCCARNET'],
      out['SOCNUMERO'],
      out['CONNROASIE'], // CTACTE/CTACTE1 (the actual PK — CCTCUENTA can repeat)
      out['SECNUMERO'],
      out['ASINUMERO'],
      out['COBNUMERO'],
      out['PCTCTAPRIN'],
      out['ESCCODIGO'],
      out['DEPCODIGO'],
      out['LCNNUMERO'],
      out['CAJNUMERO'],
      // GASTOS: composite key (no single-column PK in legacy schema)
      composeGastosKey(out),
    ]) ?? ''
  out['LEGACY_KEY'] = legacyKey
  return out as LegacyRecord
}

function firstNonEmpty(values: Array<unknown>): string | null {
  for (const v of values) {
    if (v === undefined || v === null || v === '') continue
    return String(v)
  }
  return null
}

/**
 * Composite legacy key for GASTOS table — no single column is unique.
 * `GASTIPGAST` (expense type) + `GASCTAPRIN` (account) + `GASSECUENC` (sequence).
 */
function composeGastosKey(row: Record<string, unknown>): string | null {
  const tipo = row['GASTIPGAST']
  const cta = row['GASCTAPRIN']
  if (tipo === undefined || cta === undefined || tipo === null || cta === null) return null
  return `${tipo}-${cta}-${row['GASSECUENC'] ?? 0}`
}

/**
 * Drop the derived `LEGACY_KEY` field before storing the payload —
 * the column is part of `raw_events.source_key` already, and keeping
 * it inside `payload` would muddy the canonicalization for hashing.
 */
function stripLegacyKey(record: LegacyRecord): Record<string, unknown> {
  const { LEGACY_KEY: _drop, ...rest } = record
  void _drop
  return rest
}

async function hasAnyEvent(db: Db, sourceTable: LegacyTableName): Promise<boolean> {
  // The pipeline's dependency check is "has the dep been imported at
  // all in raw_events?" — checking across all batches is correct
  // because once a dep lands in raw_events, the table is importable
  // in every subsequent batch. The standin's `.limit(1)` is
  // sufficient for the existence check; a real PG plan uses the
  // `idx_raw_events_source_key` index.
  const rows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(eq(rawEvents.sourceTable, sourceTable))
    .limit(1)
  return rows.length > 0
}

/**
 * Look up or create a stable UUID for a (source_table, source_key) pair.
 *
 * Uses `ON CONFLICT DO NOTHING` on the composite PK to handle the race:
 * if two concurrent imports both try to create the same UUID, one wins,
 * the other gets a no-op, and both re-read to get the winner's UUID.
 *
 * This is the spec's Decision 4A (UUID generated at import, reused on
 * re-import, robust to concurrent inserts).
 */
export async function getOrCreateEntityUuid(
  db: Db,
  sourceTable: string,
  sourceKey: string,
): Promise<string> {
  // Try to find existing UUID
  const [existing] = await db
    .select({ entityUuid: entityUuids.entityUuid })
    .from(entityUuids)
    .where(and(eq(entityUuids.sourceTable, sourceTable), eq(entityUuids.sourceKey, sourceKey)))
    .limit(1)
  if (existing) return existing.entityUuid

  // Create new UUID
  const uuid = crypto.randomUUID()
  await db
    .insert(entityUuids)
    .values({ sourceTable, sourceKey, entityUuid: uuid })
    .onConflictDoNothing({
      target: [entityUuids.sourceTable, entityUuids.sourceKey],
    })

  // Re-read on conflict (a concurrent insert won the race)
  const [row] = await db
    .select({ entityUuid: entityUuids.entityUuid })
    .from(entityUuids)
    .where(and(eq(entityUuids.sourceTable, sourceTable), eq(entityUuids.sourceKey, sourceKey)))
    .limit(1)

  return row?.entityUuid ?? uuid
}

async function insertRawEvent(db: Db, row: NewRawEvent): Promise<boolean> {
  // entity_uuids are populated lazily by a separate background job
  // to avoid blocking the import. Single-row insert is used as
  // fallback when batch flush fails — we still need it for error
  // diagnosis (which specific row in the batch was bad).
  const inserted = await db
    .insert(rawEvents)
    .values(row)
    .onConflictDoNothing({
      target: [rawEvents.sourceTable, rawEvents.sourceKey, rawEvents.contentHash],
    })
    .returning({ id: rawEvents.id })
  return inserted.length > 0
}

/**
 * Batched INSERT for raw_events. Inserts up to 1000 rows in a single
 * multi-row INSERT with `ON CONFLICT DO NOTHING`. Returns the number
 * of rows actually inserted (the rest were skipped due to conflict).
 *
 * Postgres quirk: with `ON CONFLICT DO NOTHING`, `RETURNING` only
 * returns the rows that were inserted (not the conflicting ones).
 * So `inserted.length === rows.length` means all inserted, and
 * `rows.length - inserted.length` is the number of skipped conflicts.
 *
 * ~50x faster than single-row INSERTs on the 325k-row ctacte table
 * (measured at ~3000 rows/sec vs ~70 rows/sec).
 */
async function insertRawEventBatch(db: Db, rows: readonly NewRawEvent[]): Promise<number> {
  if (rows.length === 0) return 0
  // entity_uuids are populated lazily by a separate background job
  // (entity-uuid-backfill) to avoid blocking the import. The
  // getOrCreateEntityUuid calls here are intentionally NOT executed
  // — keeping the comment as a reminder for future readers.
  const inserted = await db
    .insert(rawEvents)
    .values(rows as NewRawEvent[])
    .onConflictDoNothing({
      target: [rawEvents.sourceTable, rawEvents.sourceKey, rawEvents.contentHash],
    })
    .returning({ id: rawEvents.id })
  return inserted.length
}

// Re-export for callers that want the lazy on-disk read directly.
export { readTable } from './dbf-reader.ts'
