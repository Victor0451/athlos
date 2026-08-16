import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { renderComprobante, type ComprobanteLeaseStore } from './ctacte-comprobante.ts'

vi.mock('./ctacte-mutations.ts', () => ({ getMovementsForComprobante: vi.fn() }))
vi.mock('../repository.ts', () => ({ findById: vi.fn() }))
vi.mock('@athlos/audit', () => ({ emitAudit: vi.fn() }))

describe('renderComprobante idempotency compatibility', () => {
  it('preserves the existing comprobante fingerprint and validation error', async () => {
    const claim = vi.fn<ComprobanteLeaseStore['claim']>().mockResolvedValue({
      kind: 'complete',
      result: {
        pdf: Buffer.from('pdf'),
        filename: 'receipt.pdf',
        sha256: 'sha',
        byteSize: 3,
        movementCount: 0,
      },
    })
    const leaseStore: ComprobanteLeaseStore = {
      claim,
      heartbeat: vi.fn(),
      complete: vi.fn(),
      failOrdinary: vi.fn(),
      failTimeout: vi.fn(),
    }
    const params = {
      socioId: 's-1',
      cuenta: 'principal',
      operatorId: 'o-1',
      from: '2026-07-01',
      to: '2026-07-31',
      idempotencyKey: 'existing-key',
      db: {} as never,
      leaseStore,
      pdfGenerator: { generate: vi.fn() } as never,
    }

    await expect(renderComprobante(params)).resolves.toMatchObject({ filename: 'receipt.pdf' })
    expect(claim).toHaveBeenCalledWith(
      'existing-key',
      createHash('sha256')
        .update('comprobante|o-1|s-1|principal|2026-07-01|2026-07-31')
        .digest('hex'),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    )
    await expect(
      renderComprobante({ ...params, idempotencyKey: 'a'.repeat(129) }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Key header must be 1–128 characters',
    })
  })
})
