import { driftSnapshots } from './public'
import { describe, it, expect } from 'vitest'

describe('drift_snapshots schema', () => {
  /**
   * RED: This test describes the expected shape of the drift_snapshots table.
   * It will fail until migration 0008_drift_snapshots.sql is applied
   * and the Drizzle schema is defined in public.ts.
   */

  // Access the raw column to verify runtime properties
  const entityUuidCol = (
    driftSnapshots as unknown as {
      entityUuid: { primary: boolean; notNull: boolean; dataType: string }
    }
  ).entityUuid
  const domainCol = (
    driftSnapshots as unknown as { domain: { notNull: boolean; dataType: string } }
  ).domain
  const lastHashCol = (
    driftSnapshots as unknown as { lastHash: { notNull: boolean; dataType: string } }
  ).lastHash
  const lastEventIdCol = (
    driftSnapshots as unknown as { lastEventId: { notNull: boolean; dataType: string } }
  ).lastEventId
  const snapshotAtCol = (driftSnapshots as unknown as { snapshotAt: { hasDefault: boolean } })
    .snapshotAt

  it('table has all required columns defined', () => {
    expect(entityUuidCol).toBeDefined()
    expect(domainCol).toBeDefined()
    expect(lastHashCol).toBeDefined()
    expect(lastEventIdCol).toBeDefined()
    expect(snapshotAtCol).toBeDefined()
  })

  it('entityUuid is the primary key (primary: true on column)', () => {
    expect(entityUuidCol.primary).toBe(true)
  })

  it('entityUuid is notNull', () => {
    expect(entityUuidCol.notNull).toBe(true)
  })

  it('domain is notNull', () => {
    expect(domainCol.notNull).toBe(true)
  })

  it('lastHash is notNull', () => {
    expect(lastHashCol.notNull).toBe(true)
  })

  it('lastEventId is notNull', () => {
    expect(lastEventIdCol.notNull).toBe(true)
  })

  it('snapshotAt has default (now())', () => {
    expect(snapshotAtCol.hasDefault).toBe(true)
  })

  it('table has been added to the schema barrel (index.ts re-exports it)', async () => {
    // This verifies the index.ts correctly re-exports driftSnapshots

    const schema = await import('./index')
    expect(schema['driftSnapshots']).toBeDefined()
  })
})
