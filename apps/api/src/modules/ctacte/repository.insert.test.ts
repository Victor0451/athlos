import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@athlos/db'
import { createStandinDb } from '../../test-standins/db.ts'
import { getMovimientos, insertCtacteRow, listMovementsByDateRange } from './repository.ts'

/**
 * Repository write-path tests (PR A1a — athlos-ctacte-mutations).
 *
 * Extends the read-only `ctacte/repository.test.ts` with the two
 * write helpers the ctacte-mutations service consumes:
 *   - `insertCtacteRow` for registerPayment + registerDebit
 *   - `listMovementsByDateRange` for the comprobante PDF flow
 */

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_SOCIO = '22222222-2222-4222-8222-222222222222'

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

describe('insertCtacteRow', () => {
  it('inserts a DEBITO row with debe populated and haber zero', async () => {
    const inserted = await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'DEBITO',
      concepto: 'Cuota social Julio',
      monto: '800.00',
    })
    expect(inserted.row.id).toEqual(expect.any(String))
    expect(inserted.row.socioId).toBe(SOCIO_ID)
    expect(inserted.row.tipo).toBe('DEBITO')
    expect(inserted.row.debe).toBe('800.00')
    expect(inserted.row.haber).toBe('0.00')
    expect(inserted.row.concepto).toBe('Cuota social Julio')
    expect(inserted.row.comprobanteAttachmentId).toBeNull()
  })

  it('inserts a CREDITO row with haber populated and debe zero', async () => {
    const inserted = await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Pago cuota',
      monto: '1500.00',
    })
    expect(inserted.row.tipo).toBe('CREDITO')
    expect(inserted.row.debe).toBe('0.00')
    expect(inserted.row.haber).toBe('1500.00')
    expect(inserted.row.concepto).toBe('Pago cuota')
  })

  it('persists comprobanteAttachmentId when provided', async () => {
    const ATTACHMENT_ID = '33333333-3333-4333-8333-333333333333'
    const inserted = await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Pago con comprobante',
      monto: '500.00',
      comprobanteAttachmentId: ATTACHMENT_ID,
    })
    expect(inserted.row.comprobanteAttachmentId).toBe(ATTACHMENT_ID)
  })

  it('round-trip with getMovimientos returns the inserted row', async () => {
    const inserted = await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Round-trip',
      monto: '100.00',
    })
    const page = await getMovimientos(db, {
      socioId: SOCIO_ID,
      page: 1,
      limit: 10,
    })
    expect(page.items.map((r) => r.id)).toContain(inserted.row.id)
  })
})

describe('listMovementsByDateRange', () => {
  beforeEach(async () => {
    // Seed 5 movements across a date range.
    await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-01',
      tipo: 'DEBITO',
      concepto: 'Cargo 1',
      monto: '100.00',
    })
    await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-15',
      tipo: 'CREDITO',
      concepto: 'Pago 1',
      monto: '50.00',
    })
    await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-20',
      tipo: 'DEBITO',
      concepto: 'Cargo 2',
      monto: '200.00',
    })
    await insertCtacteRow(db, {
      socioId: SOCIO_ID,
      fecha: '2026-07-31',
      tipo: 'CREDITO',
      concepto: 'Pago 2',
      monto: '300.00',
    })
    await insertCtacteRow(db, {
      socioId: OTHER_SOCIO,
      fecha: '2026-07-15',
      tipo: 'DEBITO',
      concepto: 'Other socio',
      monto: '999.00',
    })
  })

  it('returns only the socio movements within the inclusive range', async () => {
    const movements = await listMovementsByDateRange(db, {
      socioId: SOCIO_ID,
      from: '2026-07-10',
      to: '2026-07-31',
      limit: 50,
    })
    expect(movements).toHaveLength(3)
    expect(movements.every((m) => m.socioId === SOCIO_ID)).toBe(true)
    // fecha is inclusive on both ends per the standard convention.
    expect(movements.map((m) => m.concepto).sort()).toEqual(['Cargo 2', 'Pago 1', 'Pago 2'])
  })

  it('caps the result at limit (default 50)', async () => {
    const movements = await listMovementsByDateRange(db, {
      socioId: SOCIO_ID,
      from: '2026-07-01',
      to: '2026-07-31',
      limit: 2,
    })
    expect(movements).toHaveLength(2)
  })

  it('returns an empty array when no movements fall in the range', async () => {
    const movements = await listMovementsByDateRange(db, {
      socioId: SOCIO_ID,
      from: '2026-08-01',
      to: '2026-08-31',
      limit: 50,
    })
    expect(movements).toEqual([])
  })

  it('does not return movements from other socios', async () => {
    const movements = await listMovementsByDateRange(db, {
      socioId: SOCIO_ID,
      from: '2026-07-01',
      to: '2026-07-31',
      limit: 50,
    })
    expect(movements.find((m) => m.socioId === OTHER_SOCIO)).toBeUndefined()
  })
})
