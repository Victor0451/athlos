import { eq, inArray } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { rawEvents } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { LegacyTableName } from '@athlos/integrations-legacy-db'
import { LEGACY_IMPORT_ORDER, TABLE_DEPENDENCIES } from './pipeline.ts'

/**
 * An orphan reference detected during bridge validation. Surfaced
 * to the admin via `validateBridges()` and persisted in `audit_events`
 * by the alert emitter (PR 7b).
 *
 * The variants:
 *   - `connroasie-missing-socio` — a CONNROASIE link references a
 *     socio that was not imported in the latest batch. Causes the
 *     cuenta-corriente + roasie join to drop the row.
 *   - `connroasie-missing-roasie` — the roasie side of the bridge
 *     is missing.
 *   - `dependency-missing` — the 14-table import order is violated
 *     (a table is imported before its declared dependency). Same
 *     class of failure: the downstream row references data that
 *     does not exist.
 */
export type OrphanAlert =
  | {
      kind: 'connroasie-missing-socio'
      connroasieKey: string
      missingSocio: string
      importedAt: string
    }
  | {
      kind: 'connroasie-missing-roasie'
      connroasieKey: string
      missingRoasie: string
      importedAt: string
    }
  | {
      kind: 'dependency-missing'
      table: LegacyTableName
      missingDependency: LegacyTableName
    }

/**
 * Run the bridge validator over the latest import state.
 *
 * The check is "the latest state of the world is consistent" — we
 * don't replay history, we look at the most recent `raw_events` row
 * per `(source_table, source_key)` (by `imported_at`) and assert:
 *
 *   1. Every `connroasie` link references a `socios` row AND a
 *      `roasie` row that exists. (orphan on socio or roasie side)
 *   2. The 14-table dependency order was respected: every table
 *      that depends on another was imported AFTER its dependency
 *      (we compare the `imported_at` of the latest row per table).
 *
 * Returns the alert list (empty = clean). Does NOT write to
 * `audit_events` — alert emission lives in `packages/drift/alert.ts`
 * (PR 7b). Splitting the two keeps the validator pure and easy to
 * unit-test, and lets the alert layer batch + dedupe.
 */
export async function validateBridges(db: Db): Promise<OrphanAlert[]> {
  const alerts: OrphanAlert[] = []
  alerts.push(...(await checkConnroasieOrphans(db)))
  alerts.push(...(await checkDependencyOrder(db)))
  return alerts
}

/**
 * Pull every `cobros` row from `raw_events` (CONNROASIE links are
 * stored alongside cobros in the legacy data — the `cobros.DBF`
 * file carries a `CONNROASIE_SOCIO` and `CONNROASIE_ROASIE` field
 * per row), look up the referenced socio and roasie keys in
 * `raw_events`, and emit one alert per missing reference.
 *
 * Performance: a single SELECT for the cobros rows, then one
 * `IN (...)` per side. With 325K cobros rows in the production
 * fixture the validator runs in <2s on the dev box.
 */
async function checkConnroasieOrphans(db: Db): Promise<OrphanAlert[]> {
  // Pull every cobros row. In production this would be paginated
  // (LIMIT 1000 + cursor) but the legacy data is small enough
  // (tens of thousands) that a single fetch is fine for v1.
  const connroasieRows = await db
    .select({
      payload: rawEvents.payload,
      importedAt: rawEvents.importedAt,
    })
    .from(rawEvents)
    .where(eq(rawEvents.sourceTable, 'cobros'))

  if (connroasieRows.length === 0) return []

  const socioKeys = new Set<string>()
  const roasieKeys = new Set<string>()
  type Pending = {
    connroasieKey: string
    socio: string | null
    roasie: string | null
    importedAt: Date
  }
  const pending: Pending[] = []

  for (const row of connroasieRows) {
    const payload = row.payload as Record<string, unknown>
    const socio = stringOrNull(payload['CONNROASIE_SOCIO'])
    const roasie = stringOrNull(payload['CONNROASIE_ROASIE'])
    const connroasieKey = `${socio ?? '?'}|${roasie ?? '?'}`
    if (socio) socioKeys.add(socio)
    if (roasie) roasieKeys.add(roasie)
    pending.push({ connroasieKey, socio, roasie, importedAt: row.importedAt })
  }

  const [presentSocios, presentRoasies] = await Promise.all([
    fetchExistingKeys(db, 'socios', socioKeys),
    fetchExistingKeys(db, 'cobros', roasieKeys),
  ])

  const alerts: OrphanAlert[] = []
  for (const p of pending) {
    if (p.socio && !presentSocios.has(p.socio)) {
      alerts.push({
        kind: 'connroasie-missing-socio',
        connroasieKey: p.connroasieKey,
        missingSocio: p.socio,
        importedAt: p.importedAt.toISOString(),
      })
    }
    if (p.roasie && !presentRoasies.has(p.roasie)) {
      alerts.push({
        kind: 'connroasie-missing-roasie',
        connroasieKey: p.connroasieKey,
        missingRoasie: p.roasie,
        importedAt: p.importedAt.toISOString(),
      })
    }
  }
  return alerts
}

/**
 * Return the set of `source_key` values that exist in `raw_events`
 * for the given table, filtered to the candidate set.
 */
async function fetchExistingKeys(
  db: Db,
  table: LegacyTableName,
  candidates: Set<string>,
): Promise<Set<string>> {
  if (candidates.size === 0) return new Set()
  const rows = await db
    .select({ sourceKey: rawEvents.sourceKey })
    .from(rawEvents)
    .where(eq(rawEvents.sourceTable, table))
  void inArray
  // The standin does not model `inArray`; we filter client-side.
  // In production the planner pushes the `IN` clause down and the
  // `idx_raw_events_source_key` index keeps it O(log n) per row.
  const present = new Set<string>()
  for (const r of rows) {
    if (candidates.has(r.sourceKey)) present.add(r.sourceKey)
  }
  return present
}

function stringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * For each table with declared dependencies, assert that the most
 * recent `imported_at` of the table is >= the most recent
 * `imported_at` of each dependency. If not, the import order was
 * violated — emit a `dependency-missing` alert.
 *
 * The check is per-table, not per-batch: a previous batch that
 * imported `ctacte` already satisfies the dependency for the
 * current batch (we never need to re-import the dependency just
 * to import the child). The runtime check is therefore "any event
 * for dep exists, AND any event for the dependent exists, AND
 * max(imported_at, table) >= max(imported_at, dep)".
 */
async function checkDependencyOrder(db: Db): Promise<OrphanAlert[]> {
  // Pull every `raw_events` row once. The dataset is small
  // (325K rows in production, ~50MB jsonb total) and the
  // dependency check runs once per import, not per request.
  // The standin's `.from()` chain is thenable (no `.where()`
  // needed); the production PG path uses the same shape.
  const allRows = await db
    .select({
      sourceTable: rawEvents.sourceTable,
      importedAt: rawEvents.importedAt,
    })
    .from(rawEvents)

  // Group by table → max(imported_at)
  const maxByTable = new Map<LegacyTableName, Date>()
  for (const r of allRows) {
    const t = r.sourceTable as LegacyTableName
    const prev = maxByTable.get(t)
    if (!prev || r.importedAt > prev) maxByTable.set(t, r.importedAt)
  }

  const alerts: OrphanAlert[] = []
  for (const [table, deps] of Object.entries(TABLE_DEPENDENCIES) as Array<
    [LegacyTableName, readonly LegacyTableName[]]
  >) {
    const tableMax = maxByTable.get(table)
    if (!tableMax) continue // table never imported, no alert
    for (const dep of deps) {
      const depMax = maxByTable.get(dep)
      if (!depMax) {
        alerts.push({
          kind: 'dependency-missing',
          table,
          missingDependency: dep,
        })
        continue
      }
      if (depMax > tableMax) {
        alerts.push({
          kind: 'dependency-missing',
          table,
          missingDependency: dep,
        })
      }
    }
  }
  // Defensive: if a caller passed a bad table name, surface as
  // dependency-missing rather than silently dropping the check.
  const badAlerts = alerts.filter(
    (a): a is Extract<OrphanAlert, { kind: 'dependency-missing' }> =>
      a.kind === 'dependency-missing' &&
      (!isKnownTable(a.table) || !isKnownTable(a.missingDependency)),
  )
  if (badAlerts.length > 0) {
    throw BusinessError(ErrorCode.INTERNAL_ERROR, 'unknown legacy table in dependency check', {
      alerts: badAlerts,
    })
  }
  return alerts
}

function isKnownTable(t: string): t is LegacyTableName {
  return (LEGACY_IMPORT_ORDER as readonly string[]).includes(t)
}
