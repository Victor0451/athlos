import type { DbfRow, LegacyDb, LegacyTableName } from './types.ts'

/**
 * In-memory DBF stub. Tests `seed()` rows per table; `readTable` returns
 * a defensive copy so callers cannot mutate the seed data.
 *
 * The seed is empty by default — tests must populate it before calling
 * `readTable`. This makes "no rows imported" assertions trivial: just
 * don't seed.
 */
export interface StubLegacyDb extends LegacyDb {
  seed(table: LegacyTableName, rows: DbfRow[]): void
  reset(): void
}

export function createStubLegacyDb(): StubLegacyDb {
  const tables = new Map<LegacyTableName, DbfRow[]>()
  return {
    async readTable(table: LegacyTableName): Promise<DbfRow[]> {
      return tables.has(table) ? tables.get(table)!.map((r) => ({ ...r })) : []
    },
    async listTables(): Promise<LegacyTableName[]> {
      return Array.from(tables.keys())
    },
    seed(table: LegacyTableName, rows: DbfRow[]): void {
      tables.set(
        table,
        rows.map((r) => ({ ...r })),
      )
    },
    reset(): void {
      tables.clear()
    },
  }
}
