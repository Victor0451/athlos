import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@athlos/errors'
import { registerPayment } from './ctacte-mutations.ts'

/**
 * `registerPayment` tests — split from the combined ctacte-mutations
 * test file (which exceeded the 200 LoC per-file cap).
 */

const repoInsertCtacteRow = vi.fn()
const repoFindCtacteByIdempotencyKey = vi.fn()
const repoListMovementsByDateRange = vi.fn()
const repoFindSocio = vi.fn()
const emitAuditMock = vi.fn()
const uploadAttachmentMock = vi.fn()
const getAttachmentMock = vi.fn()

vi.mock('../../ctacte/repository.ts', () => ({
  insertCtacteRow: (...args: unknown[]) => repoInsertCtacteRow(...args),
  findCtacteByIdempotencyKey: (...args: unknown[]) => repoFindCtacteByIdempotencyKey(...args),
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
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
  getAttachment: (...args: unknown[]) => getAttachmentMock(...args),
}))

const dbMock = {} as never

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const MOVEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTACHMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const IDEMPOTENCY_KEY = 'payment-retry-key-1'

beforeEach(() => {
  vi.clearAllMocks()
  repoFindSocio.mockResolvedValue({ id: SOCIO_ID })
  repoFindCtacteByIdempotencyKey.mockResolvedValue(null)
})

describe('registerPayment — happy path', () => {
  it('inserts a CREDITO row + emits CTACTE_PAYMENT_REGISTERED with 6-key metadata', async () => {
    repoInsertCtacteRow.mockResolvedValueOnce({
      created: true,
      row: {
        id: MOVEMENT_ID,
        socioId: SOCIO_ID,
        fecha: '2026-07-09',
        tipo: 'CREDITO',
        concepto: 'Cuota Julio',
        debe: '0.00',
        haber: '1500.00',
        comprobanteAttachmentId: null,
        createdAt: new Date(),
      },
    })
    emitAuditMock.mockResolvedValueOnce({ inserted: true, id: 'audit-1' })

    const result = await registerPayment({
      db: dbMock,
      storage: {} as never,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 1500,
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
      idempotencyKey: IDEMPOTENCY_KEY,
    })

    expect(result.tipo).toBe('CREDITO')
    expect(result.monto).toBe(1500)
    expect(repoInsertCtacteRow).toHaveBeenCalledWith(dbMock, {
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Cuota Julio',
      monto: '1500.00',
      comprobanteAttachmentId: null,
      idempotencyKey: IDEMPOTENCY_KEY,
      idempotencyOperatorId: OPERATOR_ID,
    })
    expect(emitAuditMock).toHaveBeenCalledTimes(1)
    const auditCall = emitAuditMock.mock.calls[0]![1]
    expect(auditCall.action).toBe('CTACTE_PAYMENT_REGISTERED')
    expect(auditCall.entityType).toBe('ctacte_movement')
    expect(auditCall.entityId).toBe(MOVEMENT_ID)
    expect(Object.keys(auditCall.metadata).sort()).toEqual([
      'comprobante_attachment_id',
      'concepto',
      'ctacte_id',
      'fecha',
      'monto',
      'movement_id',
    ])
    expect(auditCall.metadata.comprobante_attachment_id).toBeNull()
    expect(auditCall.metadata.monto).toBe(1500)
  })

  it('delegates comprobante upload and persists the returned attachment_id', async () => {
    uploadAttachmentMock.mockResolvedValueOnce({ id: ATTACHMENT_ID })
    repoInsertCtacteRow.mockResolvedValueOnce({
      created: true,
      row: {
        id: MOVEMENT_ID,
        socioId: SOCIO_ID,
        fecha: '2026-07-09',
        tipo: 'CREDITO',
        concepto: 'Cuota Julio',
        debe: '0.00',
        haber: '500.00',
        comprobanteAttachmentId: ATTACHMENT_ID,
        createdAt: new Date(),
      },
    })
    emitAuditMock.mockResolvedValueOnce({ inserted: true, id: 'audit-1' })

    const bytes = Buffer.from('PDF-CONTENT')
    await registerPayment({
      db: dbMock,
      storage: {} as never,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 500,
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
      comprobante: { bytes, mimeType: 'application/pdf', filename: 'comprobante.pdf' },
      idempotencyKey: IDEMPOTENCY_KEY,
    })

    expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
    const uploadArgs = uploadAttachmentMock.mock.calls[0]![0]
    expect(uploadArgs.socioId).toBe(SOCIO_ID)
    expect(uploadArgs.category).toBe('comprobante')
    expect(uploadArgs.declaredMimeType).toBe('application/pdf')
    expect(uploadArgs.filename).toBe('comprobante.pdf')

    const insertArgs = repoInsertCtacteRow.mock.calls[0]![1]
    expect(insertArgs.comprobanteAttachmentId).toBe(ATTACHMENT_ID)

    const auditCall = emitAuditMock.mock.calls[0]![1]
    expect(auditCall.metadata.comprobante_attachment_id).toBe(ATTACHMENT_ID)
  })
})

describe('registerPayment — idempotency', () => {
  it('replays an identical payment without inserting or emitting another audit event', async () => {
    repoFindCtacteByIdempotencyKey.mockResolvedValueOnce({
      id: MOVEMENT_ID,
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Cuota Julio',
      haber: '1500.00',
      comprobanteAttachmentId: null,
    })

    const result = await registerPayment({
      db: dbMock,
      storage: {} as never,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 1500,
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
      idempotencyKey: IDEMPOTENCY_KEY,
    })

    expect(result.id).toBe(MOVEMENT_ID)
    expect(repoInsertCtacteRow).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('rejects a reused key when the canonical payment payload changes', async () => {
    repoFindCtacteByIdempotencyKey.mockResolvedValueOnce({
      id: MOVEMENT_ID,
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Cuota Julio',
      haber: '1500.00',
      comprobanteAttachmentId: null,
    })

    await expect(
      registerPayment({
        db: dbMock,
        storage: {} as never,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 1600,
        fecha: '2026-07-09',
        concepto: 'Cuota Julio',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(repoInsertCtacteRow).not.toHaveBeenCalled()
  })

  it.each([
    ['date', { fecha: '2026-07-08' }],
    ['concept', { concepto: 'Cuota Agosto' }],
  ])('rejects a reused key when the payment %s changes', async (_label, changes) => {
    repoFindCtacteByIdempotencyKey.mockResolvedValueOnce({
      id: MOVEMENT_ID,
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Cuota Julio',
      haber: '1500.00',
      comprobanteAttachmentId: null,
    })

    await expect(
      registerPayment({
        db: dbMock,
        storage: {} as never,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 1500,
        fecha: '2026-07-09',
        concepto: 'Cuota Julio',
        idempotencyKey: IDEMPOTENCY_KEY,
        ...changes,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejects a reused key when the attachment identity changes', async () => {
    repoFindCtacteByIdempotencyKey.mockResolvedValueOnce({
      id: MOVEMENT_ID,
      socioId: SOCIO_ID,
      fecha: '2026-07-09',
      tipo: 'CREDITO',
      concepto: 'Cuota Julio',
      haber: '1500.00',
      comprobanteAttachmentId: ATTACHMENT_ID,
    })
    getAttachmentMock.mockResolvedValueOnce({ storageSha256: 'different-attachment-hash' })

    await expect(
      registerPayment({
        db: dbMock,
        storage: {} as never,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 1500,
        fecha: '2026-07-09',
        concepto: 'Cuota Julio',
        comprobante: {
          bytes: Buffer.from('new attachment'),
          mimeType: 'application/pdf',
          filename: 'comprobante.pdf',
        },
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('registerPayment — validation errors', () => {
  it('throws VALIDATION_ERROR when monto <= 0 (no insert, no audit)', async () => {
    await expect(
      registerPayment({
        db: dbMock,
        storage: {} as never,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 0,
        fecha: '2026-07-09',
        concepto: 'X',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await expect(
      registerPayment({
        db: dbMock,
        storage: {} as never,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: -100,
        fecha: '2026-07-09',
        concepto: 'X',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    expect(repoInsertCtacteRow).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the socio does not exist', async () => {
    repoFindSocio.mockResolvedValueOnce(null)
    await expect(
      registerPayment({
        db: dbMock,
        storage: {} as never,
        socioId: 'missing',
        operatorId: OPERATOR_ID,
        monto: 500,
        fecha: '2026-07-09',
        concepto: 'X',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(repoInsertCtacteRow).not.toHaveBeenCalled()
  })
})
