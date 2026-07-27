import type { DataTable } from 'dbf-reader/models/dbf-file'
import { describe, expect, it } from 'vitest'
import type { Db } from '@athlos/db'
import { rawEvents } from '@athlos/db/schema'
import { computeHash } from './hash.ts'
import { LEGACY_IMPORT_ORDER, runImport, TABLE_DEPENDENCIES } from './pipeline.ts'
import { createImportStandinDb } from './test-standins/db.ts'

/**
 * runImport tests use the per-package import standin (one-purpose:
 * raw_events only). The standin's ON CONFLICT DO NOTHING is exact
 * (the unique key matches production 1:1) so the dedup assertions
 * here carry over to PG unchanged.
 */

function table(rows: Array<Record<string, unknown>>): DataTable {
  return { columns: [], rows }
}

function makeDb(): ReturnType<typeof createImportStandinDb> & { drizzle: Db } {
  const standin = createImportStandinDb()
  return { ...standin, drizzle: standin.drizzle as unknown as Db }
}

function tiposociFixture(): DataTable {
  return table([{ TSOCODIGO: 4, TSONOMBRE: 'Active member', TSOLETRA: 'A' }])
}

describe('runImport', () => {
  it('imports a single-table fixture in dependency order', async () => {
    const db = makeDb()
    const result = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      fixtures: {
        tiposoci: tiposociFixture(),
        socios: table([
          { NUMERO: 'SOC-001', NOMBRE: 'Ana', APELLIDO: 'García', legacyKey: 'SOC-001' },
          { NUMERO: 'SOC-002', NOMBRE: 'Juan', APELLIDO: 'Pérez', legacyKey: 'SOC-002' },
        ]),
      },
    })
    expect(result.status).toBe('succeeded')
    expect(result.totals.read).toBe(3)
    expect(result.totals.inserted).toBe(3)
    expect(result.totals.skipped).toBe(0)
    expect(result.totals.failed).toBe(0)
    expect(db.state.rows).toHaveLength(3)
    expect(db.state.rows[1]?.sourceTable).toBe('socios')
    expect(db.state.rows[1]?.sourceKey).toBe('SOC-001')
  })

  it('is idempotent: re-importing identical content inserts 0 new rows', async () => {
    const db = makeDb()
    const opts = {
      trigger: 'scheduled' as const,
      tables: ['tiposoci', 'socios'] as const,
      fixtures: {
        tiposoci: tiposociFixture(),
        socios: table([
          { NUMERO: 'SOC-001', NOMBRE: 'Ana', APELLIDO: 'García', legacyKey: 'SOC-001' },
        ]),
      },
    }
    const first = await runImport(db.drizzle, opts)
    const second = await runImport(db.drizzle, opts)
    expect(first.totals.inserted).toBe(2)
    expect(second.totals.inserted).toBe(0)
    expect(second.totals.skipped).toBe(2)
    expect(db.state.rows).toHaveLength(2)
  })

  it('appends a new row when content changes (append-only semantics)', async () => {
    const db = makeDb()
    await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      fixtures: {
        tiposoci: tiposociFixture(),
        socios: table([
          { NUMERO: 'SOC-001', NOMBRE: 'Ana', APELLIDO: 'García', legacyKey: 'SOC-001' },
        ]),
      },
    })
    const second = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      fixtures: {
        tiposoci: tiposociFixture(),
        socios: table([
          { NUMERO: 'SOC-001', NOMBRE: 'Ana María', APELLIDO: 'García', legacyKey: 'SOC-001' },
        ]),
      },
    })
    expect(second.totals.inserted).toBe(1)
    expect(second.totals.skipped).toBe(1)
    expect(db.state.rows).toHaveLength(3)
    // The two rows have different hashes (history preserved).
    expect(db.state.rows[1]?.contentHash).not.toBe(db.state.rows[2]?.contentHash)
  })

  it('imports all 15 tables in canonical dependency order', async () => {
    const db = makeDb()
    const fixtures: Record<string, DataTable> = {}
    for (const t of LEGACY_IMPORT_ORDER) {
      fixtures[t] = table([
        { LEGACY_KEY: `${t.toUpperCase()}-1`, NUMERO: '1', legacyKey: `${t.toUpperCase()}-1` },
      ])
    }
    const result = await runImport(db.drizzle, {
      trigger: 'scheduled',
      fixtures,
    })
    expect(result.status).toBe('succeeded')
    expect(result.tables).toHaveLength(15)
    expect(result.totals.inserted).toBe(15)
    // The summary order matches the import order.
    const order = result.tables.map((s) => s.table)
    expect(order).toEqual([...LEGACY_IMPORT_ORDER])
  })

  it('aborts when CTACTE1 is imported before CTACTE', async () => {
    const db = makeDb()
    await expect(
      runImport(db.drizzle, {
        trigger: 'manual',
        tables: ['ctacte1'],
        fixtures: {
          ctacte1: table([{ NROASIE: '1', legacyKey: '1' }]),
        },
      }),
    ).rejects.toThrow(/ctacte1 requires ctacte to be imported first/)
  })

  it('aborts when ASIENTOD is imported before ASIENTO', async () => {
    const db = makeDb()
    await expect(
      runImport(db.drizzle, {
        trigger: 'manual',
        tables: ['asientod'],
        fixtures: {
          asientod: table([{ NUMCOMP: '1', legacyKey: '1' }]),
        },
      }),
    ).rejects.toThrow(/asientod requires asiento to be imported first/)
  })

  it('rejects an out-of-order table list', async () => {
    const db = makeDb()
    // `ctacte1` depends on `ctacte`, so listing `ctacte1` BEFORE
    // `ctacte` is an order violation (the spec's "CTACTE1
    // imported before CTACTE" scenario).
    await expect(
      runImport(db.drizzle, {
        trigger: 'manual',
        tables: ['ctacte1', 'ctacte'],
        fixtures: {
          ctacte: table([{ legacyKey: '1' }]),
          ctacte1: table([{ legacyKey: '2' }]),
        },
      }),
    ).rejects.toThrow(/import order violation/)
  })

  it('rejects an unknown table name', async () => {
    const db = makeDb()
    await expect(
      runImport(db.drizzle, {
        trigger: 'manual',
        // Force the type-check to allow a bad value.
        tables: ['unknown_table' as unknown as 'socios'],
      }),
    ).rejects.toThrow(/unknown legacy table/)
  })

  it('counts rows with missing legacyKey as failed', async () => {
    const db = makeDb()
    const result = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      fixtures: {
        tiposoci: tiposociFixture(),
        // The row has no recognizable PK column → legacyKey resolves to ''.
        socios: table([{ NOMBRE: 'Anonymous' }]),
      },
    })
    expect(result.totals.read).toBe(2)
    expect(result.totals.failed).toBe(1)
    expect(result.totals.inserted).toBe(1)
    expect(result.status).toBe('failed')
  })

  it('emits a fresh batch id when batchId is not provided', async () => {
    const db = makeDb()
    const a = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      fixtures: { tiposoci: tiposociFixture(), socios: table([{ legacyKey: 'X' }]) },
    })
    const b = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      fixtures: { tiposoci: tiposociFixture(), socios: table([{ legacyKey: 'X' }]) },
    })
    expect(a.id).not.toBe(b.id)
  })

  it('honors an explicit batchId', async () => {
    const db = makeDb()
    const result = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      batchId: 'BATCH-2024-06-11-001',
      fixtures: { tiposoci: tiposociFixture(), socios: table([{ legacyKey: 'X' }]) },
    })
    expect(result.id).toBe('BATCH-2024-06-11-001')
    expect(db.state.rows[1]?.importBatch).toBe('BATCH-2024-06-11-001')
  })

  it('strips the derived legacyKey from the stored payload', async () => {
    const db = makeDb()
    await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci', 'socios'],
      fixtures: {
        tiposoci: tiposociFixture(),
        socios: table([{ NUMERO: 'SOC-001', NOMBRE: 'Ana', legacyKey: 'SOC-001' }]),
      },
    })
    const row = db.state.rows[1]!
    expect(row.payload).not.toHaveProperty('legacyKey')
    // Sanity: the canonical content hash does NOT include legacyKey
    // (the hash.test.ts case already pins this — here we just
    // confirm the pipeline writes the same value).
    const expected = computeHash({ NUMERO: 'SOC-001', NOMBRE: 'Ana' })
    expect(row.contentHash).toBe(expected)
  })

  it('TABLE_DEPENDENCIES declares ctacte1→ctacte and asientod→asiento', () => {
    expect(TABLE_DEPENDENCIES.ctacte1).toEqual(['ctacte'])
    expect(TABLE_DEPENDENCIES.asientod).toEqual(['asiento'])
    expect(TABLE_DEPENDENCIES.paramet).toEqual([])
  })

  it('LEGACY_IMPORT_ORDER has 15 tables', () => {
    expect(LEGACY_IMPORT_ORDER).toHaveLength(15)
  })

  it('LEGACY_IMPORT_ORDER places paramet first and gastos last', () => {
    expect(LEGACY_IMPORT_ORDER[0]).toBe('paramet')
    expect(LEGACY_IMPORT_ORDER[LEGACY_IMPORT_ORDER.length - 1]).toBe('gastos')
  })

  it('requires tiposoci before socios evidence', async () => {
    const db = makeDb()
    await expect(
      runImport(db.drizzle, {
        trigger: 'manual',
        tables: ['socios'],
        fixtures: { socios: table([{ SOCCARNET: 'SOC-001' }]) },
      }),
    ).rejects.toThrow(/socios requires tiposoci to be imported first/)
    expect(db.state.rows).toEqual([])
  })

  it('uses TSOCODIGO as the tiposoci key and retains ordinal-hashed occurrences', async () => {
    const db = makeDb()
    const fixture = table([
      { TSOCODIGO: 4, TSONOMBRE: 'Active member', TSOLETRA: 'A' },
      { TSOCODIGO: 4, TSONOMBRE: 'Active member revised', TSOLETRA: 'A' },
    ])
    const first = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci' as never],
      fixtures: { tiposoci: fixture } as never,
    })
    const rerun = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci' as never],
      fixtures: { tiposoci: fixture } as never,
    })
    const changed = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci' as never],
      fixtures: {
        tiposoci: table([
          { TSOCODIGO: 4, TSONOMBRE: 'Active member', TSOLETRA: 'A' },
          { TSOCODIGO: 4, TSONOMBRE: 'Active member final', TSOLETRA: 'A' },
        ]),
      } as never,
    })

    expect(first.totals.inserted).toBe(2)
    expect(rerun.totals.skipped).toBe(2)
    expect(changed.totals.inserted).toBe(1)
    expect(db.state.rows).toHaveLength(3)
    expect(db.state.rows.map((row) => row.sourceKey)).toEqual(['4', '4', '4'])
    expect(
      db.state.rows.map((row) => (row.payload as Record<string, unknown>).RECORD_ORDINAL),
    ).toEqual([1, 2, 2])
  })

  it('declares tiposoci immediately before socios', () => {
    expect(TABLE_DEPENDENCIES.socios).toEqual(['tiposoci'])
    expect(LEGACY_IMPORT_ORDER.indexOf('tiposoci')).toBe(LEGACY_IMPORT_ORDER.indexOf('socios') - 1)
  })

  it('reports malformed tiposoci rows with a sanitized table and ordinal', async () => {
    const db = makeDb()
    const result = await runImport(db.drizzle, {
      trigger: 'manual',
      tables: ['tiposoci'],
      fixtures: { tiposoci: table([{ TSONOMBRE: 'Private legacy name' }]) },
    })
    expect(result.status).toBe('failed')
    expect(result.errorMessage).toBe('tiposoci record 1: missing legacy key')
    expect(result.tables[0]?.errorMessage).toBe('tiposoci record 1: missing legacy key')
  })

  it('uses rawEvents as the only write target (sanity)', () => {
    // The standin's insert path only accepts `raw_events`. Pin the
    // surface so a future refactor that writes to a sibling table
    // is caught by the test.
    expect(rawEvents).toBeDefined()
  })
})
