import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Db } from '@athlos/db'
import { computeSaldo } from './saldo.ts'

// Helper to create a typed SQL result
const makeResult = (rowCount: number, rows?: unknown[]) =>
  ({ rowCount, rows: rows ?? [] }) as unknown as never

// --- mock rows for ctacte ---
interface CtacteRow {
  debe: string
  haber: string
  anulado: boolean
}

const row = (debe: string, haber: string, anulado = false): CtacteRow => ({
  debe,
  haber,
  anulado,
})

describe('computeSaldo', () => {
  // entity_uuids lookup result shape — SQL selects source_key which IS socios.id
  const foundUuidRow = { id: 'socio-db-uuid-1' }

  // ctacte rows for socio-1: 3 non-anulada, 1 anulada (should be excluded)
  const ctacteRows = [
    row('100.50', '0.00'), // +100.50
    row('0.00', '30.00'), // -30.00  → saldo parcial: 70.50
    row('50.00', '0.00'), // +50.00  → saldo parcial: 120.50
    row('0.00', '20.00', true), // anulada — should be excluded by JS filter
    row('10.00', '5.00'), // +10.00 -5.00 = +5 → saldo final: 125.50
  ]
  const expectedDebe = '160.50' // 100.50 + 50.00 + 10.00
  const expectedHaber = '35.00' // 30.00 + 5.00
  const expectedSaldo = '125.50' // 160.50 - 35.00

  let mockDb: Db
  let mockExecute: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockExecute = vi.fn()
    mockDb = {
      execute: mockExecute,
    } as unknown as never
  })

  it('returns { socioEntityId, debe, haber, saldo, as_of }', async () => {
    // Setup: entity_uuids returns the socio id, ctacte returns rows
    mockExecute.mockResolvedValueOnce(makeResult(1, [foundUuidRow]))
    // ctacte query returns rows
    mockExecute.mockResolvedValueOnce(makeResult(ctacteRows.length, ctacteRows))

    const result = await computeSaldo(mockDb, 'entity-uuid-socio-1')

    expect(result).toMatchObject({
      socioEntityId: 'entity-uuid-socio-1',
      debe: expectedDebe,
      haber: expectedHaber,
      saldo: expectedSaldo,
    })
    expect(typeof result.as_of).toBe('string')
    expect(new Date(result.as_of).getTime()).toBeGreaterThan(0)
  })

  it('excludes anulada rows from debe/haber/saldo sum', async () => {
    mockExecute.mockResolvedValueOnce(makeResult(1, [foundUuidRow]))
    mockExecute.mockResolvedValueOnce(makeResult(ctacteRows.length, ctacteRows))

    const result = await computeSaldo(mockDb, 'entity-uuid-socio-1')

    // Anulada row had debe=0, haber=20 → excluded
    expect(result.debe).toBe(expectedDebe)
    expect(result.haber).toBe(expectedHaber)
    expect(result.saldo).toBe(expectedSaldo)
  })

  it('throws if entity_uuids lookup finds no row', async () => {
    // entity_uuids returns 0 rows
    mockExecute.mockResolvedValueOnce(makeResult(0))

    await expect(computeSaldo(mockDb, 'unknown-entity')).rejects.toThrow('entity_uuid not found')
  })
})
