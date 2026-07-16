import { describe, expect, it, vi } from 'vitest'
import {
  renderComprobante,
  type ComprobanteLeaseStore,
  type RenderComprobanteResult,
} from './ctacte-comprobante.ts'

vi.mock('./ctacte-mutations.ts', () => ({
  getMovementsForComprobante: vi.fn().mockResolvedValue([
    {
      id: 'm-1',
      fecha: '2026-07-05',
      tipo: 'CREDITO',
      monto: 1500,
      concepto: 'Cuota',
      motivo: null,
      saldo: -1500,
    },
  ]),
}))
vi.mock('../repository.ts', () => ({
  findById: vi.fn().mockResolvedValue({
    id: 's-1',
    numeroSocio: '1',
    apellido: 'Pérez',
    nombre: 'Juan',
    dni: '1',
  }),
}))
vi.mock('@athlos/audit', () => ({ emitAudit: vi.fn().mockResolvedValue({ inserted: true }) }))

type Row = {
  fingerprint: string
  status: 'rendering' | 'complete' | 'failed'
  owner: string | null
  expiresAt: number
  result?: RenderComprobanteResult
}

function createSharedReplicaStore(): ComprobanteLeaseStore {
  const rows = new Map<string, Row>()
  return {
    async claim(key, fingerprint, owner, now, leaseMs) {
      const row = rows.get(key)
      if (!row) {
        rows.set(key, { fingerprint, status: 'rendering', owner, expiresAt: now + leaseMs })
        return { kind: 'owner' }
      }
      if (row.fingerprint !== fingerprint) return { kind: 'conflict' }
      if (row.status === 'failed' || (row.status === 'rendering' && row.expiresAt <= now)) {
        rows.set(key, { fingerprint, status: 'rendering', owner, expiresAt: now + leaseMs })
        return { kind: 'owner' }
      }
      if (row.status === 'complete') return { kind: 'complete', result: row.result! }
      return { kind: 'follower' }
    },
    async heartbeat(key, owner, now, leaseMs) {
      const row = rows.get(key)
      return Boolean(
        row?.status === 'rendering' &&
        row.owner === owner &&
        ((row.expiresAt = now + leaseMs), true),
      )
    },
    async complete(key, owner, result) {
      const row = rows.get(key)
      if (!row || row.owner !== owner || row.status !== 'rendering') return false
      rows.set(key, {
        fingerprint: row.fingerprint,
        status: 'complete',
        owner: null,
        expiresAt: Number.MAX_SAFE_INTEGER,
        result,
      })
      return true
    },
    async fail(key, owner) {
      const row = rows.get(key)
      if (!row || row.owner !== owner || row.status !== 'rendering') return false
      rows.set(key, { ...row, status: 'failed', owner: null })
      return true
    },
  }
}

const params = (
  leaseStore: ComprobanteLeaseStore,
  pdfGenerator: { generate: (html: string) => Promise<Buffer> },
) => ({
  socioId: 's-1',
  cuenta: 'principal',
  operatorId: 'o-1',
  from: '2026-07-01',
  to: '2026-07-31',
  idempotencyKey: 'replay-key',
  db: {} as never,
  leaseStore,
  pdfGenerator: pdfGenerator as never,
  leaseDurationMs: 100,
  heartbeatMs: 20,
})

describe('renderComprobante durable lease', () => {
  it('heartbeats a slow owner and makes a second replica replay the full completed result', async () => {
    const store = createSharedReplicaStore()
    let release: (value: Buffer) => void = () => undefined
    const ownerGenerator = {
      generate: vi.fn(
        () =>
          new Promise<Buffer>((resolve) => {
            release = resolve
          }),
      ),
    }
    const owner = renderComprobante(params(store, ownerGenerator))
    await vi.waitFor(() => expect(ownerGenerator.generate).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 160))
    const followerGenerator = { generate: vi.fn(async () => Buffer.from('should-not-render')) }
    const follower = renderComprobante(params(store, followerGenerator))
    release(Buffer.from('%PDF-lease'))
    const [first, replay] = await Promise.all([owner, follower])
    expect(replay).toEqual(first)
    expect(replay.movementCount).toBe(1)
    expect(followerGenerator.generate).not.toHaveBeenCalled()
  })

  it('marks a failed owner retryable so a restarted replica can reclaim and complete', async () => {
    const store = createSharedReplicaStore()
    await expect(
      renderComprobante(
        params(store, {
          generate: vi.fn(async () => {
            throw new Error('renderer down')
          }),
        }),
      ),
    ).rejects.toThrow('renderer down')
    const recovered = await renderComprobante(
      params(store, { generate: vi.fn(async () => Buffer.from('%PDF-recovered')) }),
    )
    expect(recovered.pdf.toString()).toBe('%PDF-recovered')
    expect(recovered.movementCount).toBe(1)
  })

  it('replays completed work for the same actor but rejects another actor using the key', async () => {
    const store = createSharedReplicaStore()
    const ownerGenerator = { generate: vi.fn(async () => Buffer.from('%PDF-actor-a')) }
    const actorA = params(store, ownerGenerator)

    const completed = await renderComprobante(actorA)
    const replayGenerator = { generate: vi.fn(async () => Buffer.from('should-not-render')) }
    const replay = await renderComprobante({ ...actorA, pdfGenerator: replayGenerator as never })

    expect(replay).toEqual(completed)
    expect(replayGenerator.generate).not.toHaveBeenCalled()
    await expect(
      renderComprobante({
        ...actorA,
        operatorId: 'o-2',
        pdfGenerator: replayGenerator as never,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(replayGenerator.generate).not.toHaveBeenCalled()
  })

  it('rejects a changed request fingerprint before reclaiming failed or stale claims', async () => {
    const store = createSharedReplicaStore()
    const now = Date.now()
    await expect(
      store.claim('failed-key', 'range-a', 'owner-a', now, 100, 60_000),
    ).resolves.toEqual({
      kind: 'owner',
    })
    await store.fail('failed-key', 'owner-a')
    await expect(
      store.claim('failed-key', 'range-b', 'owner-b', now + 1, 100, 60_000),
    ).resolves.toEqual({
      kind: 'conflict',
    })

    await expect(store.claim('stale-key', 'range-a', 'owner-a', now, 1, 60_000)).resolves.toEqual({
      kind: 'owner',
    })
    await expect(
      store.claim('stale-key', 'range-b', 'owner-b', now + 2, 100, 60_000),
    ).resolves.toEqual({
      kind: 'conflict',
    })
  })
})
