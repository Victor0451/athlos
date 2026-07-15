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
const compensateNewAttachmentMock = vi.fn()

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

vi.mock('../../socios/attachments.ts', () => ({
  uploadAttachment: vi.fn(),
  getAttachment: vi.fn(),
  compensateNewAttachment: (...args: unknown[]) => compensateNewAttachmentMock(...args),
}))

const txMock = { kind: 'transaction' }
const transactionSpy = vi.fn(<T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txMock))
const dbMock = { transaction: transactionSpy } as never

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
      row: {
        id: MOVEMENT_ID,
        socioId: SOCIO_ID,
        fecha: '2026-07-09',
        tipo: 'DEBITO',
        concepto: 'Cuota social Julio',
        debe: '800.00',
        haber: '0.00',
        comprobanteAttachmentId: null,
        idempotencyOperatorId: '00000000-0000-4000-8000-000000000002',
        createdAt: new Date(),
      },
      created: true,
    })
    emitAuditMock.mockResolvedValueOnce({ inserted: true, id: 'audit-2' })

    const result = await registerDebit({
      db: dbMock,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 800,
      fecha: '2026-07-09',
      motivo: 'Cuota social Julio',
      idempotencyKey: 'debit-intent-1',
    })

    expect(result.tipo).toBe('DEBITO')
    expect(result.monto).toBe(800)
    expect(result.motivo).toBe('Cuota social Julio')
    expect(result.concepto).toBeNull()
    expect(transactionSpy).toHaveBeenCalledOnce()
    expect(repoInsertCtacteRow).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        socioId: SOCIO_ID,
        fecha: '2026-07-09',
        tipo: 'DEBITO',
        concepto: 'Cuota social Julio',
        monto: '800.00',
        comprobanteAttachmentId: null,
        idempotencyKey: 'debit-intent-1',
      }),
    )
    expect(emitAuditMock).toHaveBeenCalledOnce()
    expect(emitAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        operatorId: OPERATOR_ID,
        action: 'CTACTE_DEBIT_REGISTERED',
        entityType: 'ctacte_movement',
        entityId: MOVEMENT_ID,
        callerKey: 'debit-intent-1',
        metadata: {
          ctacte_id: SOCIO_ID,
          movement_id: MOVEMENT_ID,
          monto: 800,
          fecha: '2026-07-09',
          motivo: 'Cuota social Julio',
        },
      }),
    )
  })

  it('propagates an audit failure so the transaction can roll back without compensation', async () => {
    repoInsertCtacteRow.mockResolvedValueOnce({
      row: {
        id: MOVEMENT_ID,
        socioId: SOCIO_ID,
        fecha: '2026-07-09',
        tipo: 'DEBITO',
        concepto: 'Mora Julio',
        debe: '900.00',
        haber: '0.00',
        comprobanteAttachmentId: null,
        idempotencyOperatorId: OPERATOR_ID,
        createdAt: new Date(),
      },
      created: true,
    })
    emitAuditMock.mockRejectedValueOnce(new Error('forced debit audit failure'))

    await expect(
      registerDebit({
        db: dbMock,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 900,
        fecha: '2026-07-09',
        motivo: 'Mora Julio',
        idempotencyKey: 'debit-audit-failure-1',
      }),
    ).rejects.toThrow('forced debit audit failure')

    expect(transactionSpy).toHaveBeenCalledOnce()
    expect(repoInsertCtacteRow).toHaveBeenCalledWith(txMock, expect.anything())
    expect(emitAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ callerKey: 'debit-audit-failure-1' }),
    )
    expect(compensateNewAttachmentMock).not.toHaveBeenCalled()
  })

  it('conflicts when a different operator reuses the same debit key', async () => {
    repoInsertCtacteRow.mockResolvedValueOnce({
      row: {
        id: MOVEMENT_ID,
        socioId: SOCIO_ID,
        fecha: '2026-07-09',
        tipo: 'DEBITO',
        concepto: 'Cuota social Julio',
        debe: '800.00',
        haber: '0.00',
        comprobanteAttachmentId: null,
        idempotencyOperatorId: '00000000-0000-4000-8000-000000000002',
      },
      created: false,
    })
    await expect(
      registerDebit({
        db: dbMock,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 800,
        fecha: '2026-07-09',
        motivo: 'Cuota social Julio',
        idempotencyKey: 'debit-intent-1',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('replays an existing debit only when the caller key has the same canonical payload', async () => {
    repoInsertCtacteRow.mockResolvedValueOnce({
      row: {
        id: MOVEMENT_ID,
        socioId: SOCIO_ID,
        fecha: '2026-07-09',
        tipo: 'DEBITO',
        concepto: 'Cuota social Julio',
        debe: '800.00',
        haber: '0.00',
        comprobanteAttachmentId: null,
        idempotencyOperatorId: OPERATOR_ID,
      },
      created: false,
    })

    const replay = await registerDebit({
      db: dbMock,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 800,
      fecha: '2026-07-09',
      motivo: 'Cuota social Julio',
      idempotencyKey: 'debit-intent-1',
    })

    expect(replay.id).toBe(MOVEMENT_ID)
    expect(emitAuditMock).not.toHaveBeenCalled()
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
        idempotencyKey: 'invalid-debit-intent',
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
        idempotencyKey: 'missing-socio-debit-intent',
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
