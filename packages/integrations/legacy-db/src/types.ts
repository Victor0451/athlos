/**
 * A single row read from a legacy DBF table. The legacy schema has ~50
 * different column shapes across the 14 tables (USUARIO, SOCIOS, CTACTE,
 * etc.) — keeping the row as `Record<string, unknown>` lets the import
 * pipeline apply the typed shape per table downstream.
 */
export type DbfRow = Record<string, unknown>

/**
 * The 15 legacy tables imported by the import pipeline (PR 7). Order
 * matters — the import runs tables in dependency order (paramet → socios
 * → ctacte → …) so FKs resolve. The list comes from the legacy-import
 * spec and matches the Visual FoxPro schema map.
 */
export type LegacyTableName =
  | 'paramet'
  | 'tiposoci'
  | 'usuario'
  | 'ctacte1'
  | 'socios'
  | 'ctacte'
  | 'asiento'
  | 'asientod'
  | 'cobros'
  | 'plancue'
  | 'catastros'
  | 'escuela'
  | 'deportes'
  | 'locacion'
  | 'caja'
  | 'gastos'

/**
 * Legacy DBF reader contract. The full import pipeline (PR 7) uses
 * `readTable` to stream rows; tests use `seed` to install fixtures
 * without touching the filesystem.
 */
export interface LegacyDb {
  /** Read every row in `table`. The real adapter streams from disk. */
  readTable(table: LegacyTableName): Promise<DbfRow[]>
  /** List available table names on the source (subset of LegacyTableName). */
  listTables(): Promise<LegacyTableName[]>
}
