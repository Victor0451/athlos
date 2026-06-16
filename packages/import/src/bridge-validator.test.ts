import { describe, expect, it } from 'vitest'
import type { Db } from '@athlos/db'
import { validateBridges } from './bridge-validator.ts'
import { createImportStandinDb } from './test-standins/db.ts'
import { computeHash } from './hash.ts'

/**
 * bridge-validator tests use the same per-package standin as the
 * pipeline tests. The validator's "fetch every cobros row" path
 * is the only Drizzle surface it exercises.
 */

function makeDb(): ReturnType<typeof createImportStandinDb> & { drizzle: Db } {
  const standin = createImportStandinDb()
  return { ...standin, drizzle: standin.drizzle as unknown as Db }
}

async function seedRawEvent(
  db: ReturnType<typeof makeDb>,
  args: {
    sourceTable: 'cobros' | 'socios' | 'asiento' | 'asientod'
    sourceKey: string
    payload: Record<string, unknown>
    importedAt: Date
  },
): Promise<void> {
  // Push directly into `state.rows` to match what the real INSERT
  // would produce. The standin's `insert` API requires a schema
  // object whose `_.name === 'raw_events'`, which is fragile to
  // pin in tests; pushing to state is the same end state without
  // the coupling.
  const newId = () =>
    '00000000-0000-4000-8000-' +
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(12, '0')
  db.state.rows.push({
    id: newId(),
    sourceTable: args.sourceTable,
    sourceKey: args.sourceKey,
    contentHash: computeHash(args.payload),
    payload: args.payload,
    importBatch: '00000000-0000-4000-8000-000000000001',
    importedAt: args.importedAt,
  })
}

describe('validateBridges', () => {
  it('returns [] for an empty database', async () => {
    const db = makeDb()
    const alerts = await validateBridges(db.drizzle)
    expect(alerts).toEqual([])
  })

  it('returns [] when CONNROASIE links are clean (socio + roasie present)', async () => {
    const db = makeDb()
    const importedAt = new Date('2024-06-12T10:00:00Z')
    await seedRawEvent(db, {
      sourceTable: 'socios',
      sourceKey: 'SOC-001',
      payload: { NUMERO: 'SOC-001' },
      importedAt,
    })
    // The roasie-side row lives in `cobros` (CONNROASIE_ROASIE
    // references a cobros `sourceKey`). Seed both the bridge row
    // and the roasie-side row so the validator's existence check
    // passes.
    await seedRawEvent(db, {
      sourceTable: 'cobros',
      sourceKey: 'ROA-001',
      payload: { NUMERO: 'ROA-001' },
      importedAt,
    })
    await seedRawEvent(db, {
      sourceTable: 'cobros',
      sourceKey: 'COB-1',
      payload: {
        CONNROASIE_SOCIO: 'SOC-001',
        CONNROASIE_ROASIE: 'ROA-001',
      },
      importedAt,
    })
    await seedRawEvent(db, {
      sourceTable: 'cobros',
      sourceKey: 'COB-2',
      payload: {
        CONNROASIE_SOCIO: 'SOC-001',
        CONNROASIE_ROASIE: 'ROA-001',
      },
      importedAt,
    })
    const alerts = await validateBridges(db.drizzle)
    expect(alerts).toEqual([])
  })

  it('emits a connroasie-missing-socio alert when the socio is not imported', async () => {
    const db = makeDb()
    const importedAt = new Date('2024-06-12T10:00:00Z')
    // Seed the roasie-side row so the test isolates the socio
    // orphan detection.
    await seedRawEvent(db, {
      sourceTable: 'cobros',
      sourceKey: 'ROA-001',
      payload: { NUMERO: 'ROA-001' },
      importedAt,
    })
    await seedRawEvent(db, {
      sourceTable: 'cobros',
      sourceKey: 'COB-1',
      payload: {
        CONNROASIE_SOCIO: 'SOC-999',
        CONNROASIE_ROASIE: 'ROA-001',
      },
      importedAt,
    })
    const alerts = await validateBridges(db.drizzle)
    expect(alerts).toHaveLength(1)
    const a = alerts[0]!
    expect(a.kind).toBe('connroasie-missing-socio')
    if (a.kind === 'connroasie-missing-socio') {
      expect(a.missingSocio).toBe('SOC-999')
      expect(a.connroasieKey).toBe('SOC-999|ROA-001')
    }
  })

  it('emits a connroasie-missing-roasie alert when the roasie side is missing', async () => {
    const db = makeDb()
    const importedAt = new Date('2024-06-12T10:00:00Z')
    await seedRawEvent(db, {
      sourceTable: 'socios',
      sourceKey: 'SOC-001',
      payload: { NUMERO: 'SOC-001' },
      importedAt,
    })
    await seedRawEvent(db, {
      sourceTable: 'cobros',
      sourceKey: 'COB-1',
      payload: {
        CONNROASIE_SOCIO: 'SOC-001',
        CONNROASIE_ROASIE: 'ROA-999',
      },
      importedAt,
    })
    const alerts = await validateBridges(db.drizzle)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.kind).toBe('connroasie-missing-roasie')
  })

  it('emits both alerts when both sides are missing', async () => {
    const db = makeDb()
    const importedAt = new Date('2024-06-12T10:00:00Z')
    await seedRawEvent(db, {
      sourceTable: 'cobros',
      sourceKey: 'COB-1',
      payload: {
        CONNROASIE_SOCIO: 'SOC-999',
        CONNROASIE_ROASIE: 'ROA-999',
      },
      importedAt,
    })
    const alerts = await validateBridges(db.drizzle)
    expect(alerts).toHaveLength(2)
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      'connroasie-missing-roasie',
      'connroasie-missing-socio',
    ])
  })

  it('emits a dependency-missing alert when a child was imported before its parent', async () => {
    const db = makeDb()
    // The child (asientod) is imported at 09:00 and the parent
    // (asiento) at 10:00 — i.e. the child was imported BEFORE its
    // dependency. The spec's "CTACTE1 imported before CTACTE"
    // violation class.
    await seedRawEvent(db, {
      sourceTable: 'asientod',
      sourceKey: '1',
      payload: { NUMCOMP: '1' },
      importedAt: new Date('2024-06-12T09:00:00Z'),
    })
    await seedRawEvent(db, {
      sourceTable: 'asiento',
      sourceKey: '1',
      payload: { NUMCOMP: '1' },
      importedAt: new Date('2024-06-12T10:00:00Z'),
    })
    const alerts = await validateBridges(db.drizzle)
    expect(alerts).toContainEqual({
      kind: 'dependency-missing',
      table: 'asientod',
      missingDependency: 'asiento',
    })
  })

  it('does NOT emit a dependency-missing alert when the parent was imported first', async () => {
    const db = makeDb()
    await seedRawEvent(db, {
      sourceTable: 'asiento',
      sourceKey: '1',
      payload: { NUMCOMP: '1' },
      importedAt: new Date('2024-06-12T09:00:00Z'),
    })
    await seedRawEvent(db, {
      sourceTable: 'asientod',
      sourceKey: '1',
      payload: { NUMCOMP: '1' },
      importedAt: new Date('2024-06-12T10:00:00Z'),
    })
    const alerts = await validateBridges(db.drizzle)
    const depAlerts = alerts.filter((a) => a.kind === 'dependency-missing')
    expect(depAlerts).toEqual([])
  })
})
