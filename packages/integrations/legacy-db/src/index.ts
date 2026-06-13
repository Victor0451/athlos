import { createRealLegacyDb, type RealLegacyDbConfig } from './real.ts'
import { createStubLegacyDb } from './stub.ts'
import type { LegacyDb } from './types.ts'

export type { DbfRow, LegacyDb, LegacyTableName } from './types.ts'
export type { RealLegacyDbConfig } from './real.ts'
export type { StubLegacyDb } from './stub.ts'
export { createRealLegacyDb } from './real.ts'
export { createStubLegacyDb } from './stub.ts'

/**
 * Build a legacy DB adapter by flavor. `real` requires the
 * `LEGACY_DBF_PATH`; `stub` returns a fresh instance.
 */
export function createLegacyDb(opts: {
  type: 'real' | 'stub'
  config?: RealLegacyDbConfig
}): LegacyDb {
  if (opts.type === 'real') {
    if (!opts.config) {
      throw new Error('createLegacyDb({ type: "real" }) requires config')
    }
    return createRealLegacyDb(opts.config)
  }
  return createStubLegacyDb()
}
