import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@athlos/errors'
import { registerDebit } from './ctacte-mutations.ts'

/**
 * `registerDebit` tests — split from the combined ctacte-mutations
 * test file (which exceeded the 200 LoC per-file cap).
 */

const repoInsertCtacteRow = vi.fn()
const repoListMovementsByDateRange = vi.fn()
const repoFindSocio = vi.fn()
const emitAuditMock = vi.fn()

vi.mock('../../ctacte/repository.ts', () => ({
  insertCtacteRow: (...args: unknown[]) => repoInsertCtacteRow(...args),
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
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const MOVEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

beforeEach(() => {
  vi.clearAllMocks()
  repoFindSocio.mockResolvedValue({ id: SOCIO_ID })
})

describe('registerDebit', () => {
  it('inserts a DEBITO row with motivo in concepto + emits 5-key metadata', async () => {
    repoInsertCtacteRow.mockResolvedValueOnce({
      id: MOVEMENT_ID,
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'DEBITO',
      concepto: 'Cuota social Julio',
      debe: '800.00',
      haber: '0.00',
      comprobanteAttachmentId: null,
      createdAt: new Date(),
    })
    emitAuditMock.mockResolvedValueOnce({ inserted: true, id: 'audit-2' })

    const result = await registerDebit({
      db: dbMock,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 800,
      fecha: '2026-07-09',
      motivo: 'Cuota social Julio',
    })

    expect(result.tipo).toBe('DEBITO')
    expect(result.monto).toBe(800)
    expect(result.motivo).toBe('Cuota social Julio')
    expect(result.concepto).toBeNull()
    expect(repoInsertCtacteRow).toHaveBeenCalledWith(dbMock, {
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'DEBITO',
      concepto: 'Cuota social Julio',
      monto: '800.00',
      comprobanteAttachmentId: null,
    })
    expect(emitAuditMock).toHaveBeenCalledTimes(1)
    const auditCall = emitAuditMock.mock.calls[0]![1]
    expect(auditCall.action).toBe('CTACTE_DEBIT_REGISTERED')
    expect(Object.keys(auditCall.metadata).sort()).toEqual([
      'ctacte_id',
      'fecha',
      'monto',
      'motivo',
      'movement_id',
    ])
    expect(auditCall.metadata.motivo).toBe('Cuota social Julio')
    expect(auditCall.metadata.monto).toBe(800)
  })

  it('throws VALIDATION_ERROR when monto <= 0', async () => {
    await expect(
      registerDebit({
        db: dbMock,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 0,
        fecha: '2026-07-09',
        motivo: 'X',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(repoInsertCtacteRow).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the socio does not exist', async () => {
    repoFindSocio.mockResolvedValueOnce(null)
    await expect(
      registerDebit({
        db: dbMock,
        socioId: 'missing',
        operatorId: OPERATOR_ID,
        monto: 500,
        fecha: '2026-07-09',
        motivo: 'X',
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
