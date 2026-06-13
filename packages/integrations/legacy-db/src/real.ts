import type { DbfRow, LegacyDb, LegacyTableName } from './types.ts'

/**
 * Production DBF reader. Uses the `xbase` npm library (or `dbaf` as a
 * fallback if VFP types are unsupported) to read from the path in
 * `LEGACY_DBF_PATH`. The library handles dBase III/IV/Visual FoxPro
 * encoding.
 *
 * The actual `xbase` import is stubbed at the integration point — adding
 * the dep lands with PR 7 (import pipeline) where the read paths are
 * exercised end-to-end. For PR 10a the contract is enough: tests use the
 * stub and the production wiring is proven in PR 7.
 */
export interface RealLegacyDbConfig {
  /** Root path containing the 14 .DBF files, e.g. `/srv/gorriti/dbf`. */
  basePath: string
}

export function createRealLegacyDb(_config: RealLegacyDbConfig): LegacyDb {
  return {
    async readTable(_table: LegacyTableName): Promise<DbfRow[]> {
      // Integration point: const reader = await xbase.open(path.join(basePath, `${table}.DBF`))
      // return rows via fastify/stream pipeline.
      throw new Error('RealLegacyDb.readTable is not implemented yet — land in PR 7')
    },
    async listTables(): Promise<LegacyTableName[]> {
      // Integration point: read basePath/*.DBF and filter against LegacyTableName.
      throw new Error('RealLegacyDb.listTables is not implemented yet — land in PR 7')
    },
  }
}
