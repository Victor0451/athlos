import { domainFreshness } from './public'
import { describe, it, expect } from 'vitest'

describe('domain_freshness schema', () => {
  /**
   * RED: Verifies the domain_freshness table shape.
   * Fails until migration 0009_domain_freshness.sql is applied.
   */

  const domainCol = (domainFreshness as unknown as { domain: { notNull: boolean } }).domain
  const recordCountCol = (domainFreshness as unknown as { recordCount: { notNull: boolean } })
    .recordCount
  const lastImportAtCol = (domainFreshness as unknown as { lastImportAt: unknown }).lastImportAt
  const refreshedAtCol = (
    domainFreshness as unknown as { refreshedAt: { notNull: boolean; hasDefault: boolean } }
  ).refreshedAt

  it('table has all required columns defined', () => {
    expect(domainCol).toBeDefined()
    expect(recordCountCol).toBeDefined()
    expect(lastImportAtCol).toBeDefined()
    expect(refreshedAtCol).toBeDefined()
  })

  it('domain column has primary: true', () => {
    const domainCol = (domainFreshness as unknown as { domain: { primary: boolean } }).domain
    expect(domainCol.primary).toBe(true)
  })

  it('recordCount is notNull', () => {
    expect(recordCountCol.notNull).toBe(true)
  })

  it('refreshedAt is notNull with default', () => {
    expect(refreshedAtCol.notNull).toBe(true)
    expect(refreshedAtCol.hasDefault).toBe(true)
  })

  it('table has been added to the schema barrel', async () => {
    const schema = await import('./index')
    expect(schema['domainFreshness']).toBeDefined()
  })
})
