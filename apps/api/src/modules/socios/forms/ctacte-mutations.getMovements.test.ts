import { beforeEach, describe, expect, it, vi } from 'vitest'
import { argentinaBusinessDate, getMovementsForComprobante } from './ctacte-mutations.ts'

/**
 * `getMovementsForComprobante` tests — split from the combined
 * ctacte-mutations test file (which exceeded the 200 LoC per-file cap).
 */

const repoInsertCtacteRow = vi.fn()
const repoCountMovementsByDateRange = vi.fn()
const repoListMovementsByDateRange = vi.fn()
const repoFindSocio = vi.fn()
const emitAuditMock = vi.fn()

vi.mock('../../ctacte/repository.ts', () => ({
  insertCtacteRow: (...args: unknown[]) => repoInsertCtacteRow(...args),
  countMovementsByDateRange: (...args: unknown[]) => repoCountMovementsByDateRange(...args),
  listMovementsByDateRange: (...args: unknown[]) => repoListMovementsByDateRange(...args),
}))

vi.mock('../../socios/repository.ts', () => ({
  findById: (...args: unknown[]) => repoFindSocio(...args),
}))

vi.mock('@athlos/audit', () => ({
  emitAudit: (...args: unknown[]) => emitAuditMock(...args),
  AuditAction: {
    CTACTE_PAYMENT_REGISTERED: 'CTACTE_PAYMENT_REGISTERED',
    CTACTE_DEBIT_REGISTERED: 'CTACTE_DEBIT_REGISTERED',
    CTACTE_MOVEMENT_NOTE_ADDED: 'CTACTE_MOVEMENT_NOTE_ADDED',
    CTACTE_COMPROBANTE_PRINTED: 'CTACTE_COMPROBANTE_PRINTED',
  },
}))

const dbMock = {} as never
const SOCIO_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getMovementsForComprobante', () => {
  it.each([
    ['2026-07-10T02:30:00.000Z', '2026-07-09'],
    ['2026-07-10T03:30:00.000Z', '2026-07-10'],
  ])('uses Argentina calendar date at UTC boundary %s', (instant, expected) => {
    expect(argentinaBusinessDate(new Date(instant))).toBe(expected)
  })

  it('returns the movements from the repository', async () => {
    const rows = [
      { id: 'm-1', fecha: '2026-07-15', tipo: 'CREDITO' as const, debe: '0.00', haber: '50.00' },
      { id: 'm-2', fecha: '2026-07-20', tipo: 'DEBITO' as const, debe: '200.00', haber: '0.00' },
    ]
    repoListMovementsByDateRange.mockResolvedValueOnce(rows)

    const movements = await getMovementsForComprobante({
      db: dbMock,
      socioId: SOCIO_ID,
      cuenta: 'cuenta-1',
      from: '2026-07-01',
      to: '2026-07-31',
    })
    expect(movements).toHaveLength(2)
    expect(repoListMovementsByDateRange).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        socioId: SOCIO_ID,
        from: '2026-07-01',
        to: '2026-07-31',
        limit: 51,
      }),
    )
    expect(repoCountMovementsByDateRange).not.toHaveBeenCalled()
  })

  it('throws VALIDATION_ERROR from a capped 51-row fetch', async () => {
    repoListMovementsByDateRange.mockResolvedValueOnce(
      Array.from({ length: 51 }, (_, index) => ({
        id: `m-${index}`,
        fecha: '2026-07-15',
        tipo: 'CREDITO' as const,
        debe: '0.00',
        haber: '50.00',
      })),
    )

    await expect(
      getMovementsForComprobante({
        db: dbMock,
        socioId: SOCIO_ID,
        cuenta: 'cuenta-1',
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cap: 50, requested: 51 },
    })
    expect(repoCountMovementsByDateRange).not.toHaveBeenCalled()
  })

  it('rejects an interleaved 51st movement from the single capped fetch', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `m-${index}`,
      fecha: '2026-07-15',
      tipo: 'CREDITO' as const,
      debe: '0.00',
      haber: '50.00',
    }))
    repoListMovementsByDateRange.mockResolvedValueOnce(rows)

    await expect(
      getMovementsForComprobante({
        db: dbMock,
        socioId: SOCIO_ID,
        cuenta: 'cuenta-1',
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cap: 50, requested: 51 },
    })
    expect(repoCountMovementsByDateRange).not.toHaveBeenCalled()
    expect(repoListMovementsByDateRange).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({ limit: 51 }),
    )
  })
})
