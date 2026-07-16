import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  renderComprobante,
  type ComprobanteLeaseStore,
  type RenderComprobanteResult,
} from './ctacte-comprobante.ts'
import { getMovementsForComprobante } from './ctacte-mutations.ts'

/**
 * `ctacte-comprobante` glue integration test (PR A1b.2).
 *
 * Mocks the repository + the puppeteer wrapper and asserts:
 *   - Happy path: returns `{ pdf, filename, sha256, byteSize, movementCount }`
 *     + emits `CTACTE_COMPROBANTE_PRINTED` with the 7-key metadata.
 *   - 404: socio not found → throws (the route layer maps to 404).
 *   - SHA-256 of the PDF buffer matches the returned `sha256`.
 *   - `pdfGenerator.generate` is called exactly once.
 *
 * The cap-50 + date-range validation paths live in
 * `ctacte-mutations.ts` and are covered by
 * `ctacte-mutations.getMovements.test.ts`. The route layer
 * (`routes/ctacte-mutations.ts`) re-asserts the cap as
 * defence-in-depth — see A1b.4 tests.
 */

vi.mock('./ctacte-mutations.ts', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await vi.importActual('./ctacte-mutations.ts')) as any
  return {
    ...actual,
    getMovementsForComprobante: vi.fn(),
  }
})

vi.mock('../repository.ts', () => ({
  findById: vi.fn(),
}))

vi.mock('@athlos/audit', () => ({
  emitAudit: vi.fn().mockResolvedValue({ inserted: true, id: 'audit-row-1' }),
}))

import { findById } from '../repository.ts'
import { emitAudit } from '@athlos/audit'

const findByIdMock = vi.mocked(findById)
const getMovementsMock = vi.mocked(getMovementsForComprobante)
const emitAuditMock = vi.mocked(emitAudit)

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'

function buildPdfGeneratorSpy() {
  return {
    generate: vi.fn(async (html: string) => {
      // Deterministic fake PDF: any string starting with %PDF- is a
      // valid PDF header. The SHA-256 below is computed from the same
      // buffer so the glue's `sha256` field stays in sync.
      const fakePdf = Buffer.from(
        `%PDF-1.4\nFAKE_CTACTE_COMPROBANTE\nHTML_LEN=${html.length}\n%%EOF`,
      )
      return fakePdf
    }),
  }
}

function buildDurableReplayStore(): ComprobanteLeaseStore {
  const rows = new Map<
    string,
    { status: string; owner: string | null; result?: RenderComprobanteResult }
  >()
  const fail = async (key: string, owner: string) => {
    const row = rows.get(key)
    if (!row || row.owner !== owner) return false
    rows.set(key, { status: 'failed', owner: null })
    return true
  }
  return {
    async claim(key, _fingerprint, owner) {
      const row = rows.get(key)
      if (!row || row.status === 'failed') {
        rows.set(key, { status: 'rendering', owner })
        return { kind: 'owner' }
      }
      if (row.status === 'complete') return { kind: 'complete', result: row.result! }
      return { kind: 'follower' }
    },
    async heartbeat() {
      return true
    },
    async complete(key, owner, result) {
      const row = rows.get(key)
      if (!row || row.owner !== owner) return false
      rows.set(key, { status: 'complete', owner: null, result })
      return true
    },
    async failOrdinary(key, owner) {
      return fail(key, owner)
    },
    async failTimeout(key, owner) {
      return fail(key, owner)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  findByIdMock.mockResolvedValue({
    id: SOCIO_ID,
    numeroSocio: '12345',
    apellido: 'P\u00e9rez',
    nombre: 'Juan',
    dni: '28765432',
  } as never)
  getMovementsMock.mockResolvedValue([
    {
      id: 'm-1',
      fecha: '2026-07-05',
      tipo: 'CREDITO',
      monto: 1500,
      concepto: 'Cuota Julio',
      motivo: null,
      comprobanteAttachmentId: null,
      saldo: -1500,
    },
  ])
})

describe('renderComprobante — happy path', () => {
  it('returns a PDF buffer + sha256 + byteSize + emits the 7-key audit', async () => {
    const pdfGenerator = buildPdfGeneratorSpy()
    const result = await renderComprobante({
      socioId: SOCIO_ID,
      cuenta: 'PRINCIPAL',
      operatorId: OPERATOR_ID,
      from: '2026-07-01',
      to: '2026-07-31',
      idempotencyKey: 'golden-happy-comprobante-2026-07',
      db: {} as never,
      leaseStore: buildDurableReplayStore(),
      pdfGenerator: pdfGenerator as never,
    })

    expect(result.pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-')
    expect(result.byteSize).toBe(result.pdf.byteLength)
    // SHA-256 is computed from the same buffer — the assertion is
    // tautological at the byte level, but it proves the glue actually
    // hashes the buffer (not e.g. the html string).
    const expectedSha = createHash('sha256').update(result.pdf).digest('hex')
    expect(result.sha256).toBe(expectedSha)
    expect(result.movementCount).toBe(1)
    expect(result.filename).toBe('ctacte-12345-2026-07-01-2026-07-31.pdf')
    expect(pdfGenerator.generate).toHaveBeenCalledTimes(1)

    // The audit row is emitted with the exact 7-key metadata shape.
    expect(emitAuditMock).toHaveBeenCalledTimes(1)
    const auditCall = emitAuditMock.mock.calls[0]![1] as {
      action: string
      entityType: string
      metadata: Record<string, unknown>
    }
    expect(auditCall.action).toBe('CTACTE_COMPROBANTE_PRINTED')
    expect(auditCall.entityType).toBe('ctacte_comprobante')
    expect(Object.keys(auditCall.metadata).sort()).toEqual([
      'byte_size',
      'ctacte_id',
      'from',
      'movement_count',
      'sha256',
      'socio_id',
      'to',
    ])
  })

  it('throws a 404-mapped error when the socio does not exist', async () => {
    findByIdMock.mockResolvedValueOnce(null)
    const pdfGenerator = buildPdfGeneratorSpy()
    await expect(
      renderComprobante({
        socioId: SOCIO_ID,
        cuenta: 'PRINCIPAL',
        operatorId: OPERATOR_ID,
        from: '2026-07-01',
        to: '2026-07-31',
        idempotencyKey: 'golden-missing-socio-comprobante-2026-07',
        db: {} as never,
        leaseStore: buildDurableReplayStore(),
        pdfGenerator: pdfGenerator as never,
      }),
    ).rejects.toThrow(/Socio not found/i)
    // No PDF rendered, no audit emitted.
    expect(pdfGenerator.generate).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('generates one PDF and one audit event for concurrent identical retries', async () => {
    let releaseGeneration: ((pdf: Buffer) => void) | undefined
    const pdf = Buffer.from('%PDF-1.4 concurrent retry\n%%EOF')
    const pdfGenerator = {
      generate: vi.fn(
        () =>
          new Promise<Buffer>((resolve) => {
            releaseGeneration = resolve
          }),
      ),
    }
    const params = {
      socioId: SOCIO_ID,
      cuenta: 'PRINCIPAL',
      operatorId: OPERATOR_ID,
      from: '2026-07-01',
      to: '2026-07-31',
      idempotencyKey: 'golden-concurrent-comprobante-2026-07',
      db: {} as never,
      leaseStore: buildDurableReplayStore(),
      pdfGenerator: pdfGenerator as never,
    }

    const firstRequest = renderComprobante(params)
    const retryRequest = renderComprobante(params)
    await vi.waitFor(() => expect(pdfGenerator.generate).toHaveBeenCalledTimes(1))
    releaseGeneration?.(pdf)
    const [first, retry] = await Promise.all([firstRequest, retryRequest])

    expect(retry.pdf).toEqual(first.pdf)
    expect(pdfGenerator.generate).toHaveBeenCalledOnce()
    expect(emitAuditMock).toHaveBeenCalledOnce()
  })

  it('replays the completed non-zero result after an owner renders longer than 500ms', async () => {
    let releaseGeneration: ((pdf: Buffer) => void) | undefined
    const pdfGenerator = {
      generate: vi.fn(
        () =>
          new Promise<Buffer>((resolve) => {
            releaseGeneration = resolve
          }),
      ),
    }
    const params = {
      socioId: SOCIO_ID,
      cuenta: 'PRINCIPAL',
      operatorId: OPERATOR_ID,
      from: '2026-07-01',
      to: '2026-07-31',
      idempotencyKey: 'slow-replay-key',
      db: {} as never,
      leaseStore: buildDurableReplayStore(),
      pdfGenerator: pdfGenerator as never,
    }

    const owner = renderComprobante(params)
    const waiter = renderComprobante(params)
    await vi.waitFor(() => expect(pdfGenerator.generate).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 550))
    releaseGeneration?.(Buffer.from('%PDF-1.4 slow replay\n%%EOF'))

    const [first, replay] = await Promise.all([owner, waiter])
    expect(replay).toEqual(first)
    expect(replay.movementCount).toBe(1)
    expect(pdfGenerator.generate).toHaveBeenCalledOnce()
  })
})
