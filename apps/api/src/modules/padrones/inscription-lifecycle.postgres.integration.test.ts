import { randomUUID } from 'node:crypto'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeInscriptionReceipt } from './inscription-repository.ts'
import { applyCreate, applyTransition } from './inscription-service.ts'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
const table = `receipt_test_${randomUUID().replaceAll('-', '')}`
const lifecycle = `lifecycle_test_${randomUUID().replaceAll('-', '')}`
const references = `reference_test_${randomUUID().replaceAll('-', '')}`
let winner: ReturnType<typeof createDb>
let follower: ReturnType<typeof createDb>

function createBarrier() {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  return {
    entered,
    wait: async () => {
      enter()
      await released
    },
    release,
  }
}

function within<T>(promise: Promise<T>, ms = 200): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('follower claim timed out')), ms),
    ),
  ])
}

const command = {
  operatorId: 'operator-1',
  callerKey: 'key-1',
  command: 'create',
  endpoint: '/inscripciones',
  payload: { socioId: 'socio-1' },
}

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  winner = createDb({ connectionString: url, poolMax: 1 })
  follower = createDb({ connectionString: url, poolMax: 1 })
  await winner.pool.query(
    `CREATE TABLE ${table} (operator_id text NOT NULL, caller_key text NOT NULL, command text NOT NULL, request_fingerprint text NOT NULL, inscripcion_id text, result jsonb, PRIMARY KEY (operator_id, caller_key))`,
  )
  await winner.pool.query(`CREATE TABLE ${references} (id text PRIMARY KEY)`)
  await winner.pool.query(`INSERT INTO ${references} VALUES ('s-1'), ('s-2'), ('d-1'), ('e-1')`)
  await winner.pool.query(
    `CREATE TABLE ${lifecycle} (id text PRIMARY KEY, socio_id text NOT NULL REFERENCES ${references}, disciplina_id text NOT NULL REFERENCES ${references}, ejercicio_id text NOT NULL REFERENCES ${references}, fecha_alta date NOT NULL, estado text NOT NULL, baja_motivo text, fecha_baja date, UNIQUE (socio_id, disciplina_id, ejercicio_id))`,
  )
})

afterAll(async () => {
  await winner.pool.query(`DROP TABLE IF EXISTS ${table}`)
  await winner.pool.query(`DROP TABLE IF EXISTS ${lifecycle}, ${references}`)
  await Promise.all([winner.pool.end(), follower.pool.end()])
})

describe('inscription lifecycle commands', () => {
  const input = {
    table: lifecycle,
    id: 'i-1',
    socioId: 's-1',
    disciplinaId: 'd-1',
    ejercicioId: 'e-1',
    fechaAlta: '2026-01-01',
  }

  it('creates active or pending rows and returns immutable snapshots', async () => {
    const active = await winner.db.transaction((tx) =>
      applyCreate(tx, { ...input, estado: 'activa' }),
    )
    expect(active).toMatchObject({
      changed: true,
      entityId: 'i-1',
      current: 'activa',
      before: null,
    })
    const pending = await winner.db.transaction((tx) =>
      applyCreate(tx, { ...input, id: 'i-2', socioId: 's-2', estado: 'pendiente' }),
    )
    expect(pending.after).toMatchObject({ estado: 'pendiente', fecha_alta: '2026-01-01' })
    await expect(
      winner.db.transaction((tx) =>
        applyTransition(tx, { ...input, id: 'i-2', target: 'activa', expectedEstado: 'pendiente' }),
      ),
    ).rejects.toMatchObject({ kind: 'conflict' })
    await expect(
      winner.pool.query(`SELECT estado FROM ${lifecycle} WHERE id = 'i-2'`),
    ).resolves.toMatchObject({ rows: [{ estado: 'pendiente' }] })
    await expect(
      winner.db.transaction((tx) => applyCreate(tx, { ...input, id: 'i-3', estado: 'activa' })),
    ).rejects.toMatchObject({ kind: 'conflict' })
    await expect(
      winner.db.transaction((tx) =>
        applyCreate(tx, { ...input, id: 'i-4', socioId: 'missing', estado: 'activa' }),
      ),
    ).rejects.toMatchObject({ kind: 'notFound' })
  })

  it('changes baja, preserves metadata on reactivation, and no-ops locked targets', async () => {
    const baja = await winner.db.transaction((tx) =>
      applyTransition(tx, {
        ...input,
        target: 'baja',
        expectedEstado: 'activa',
        motivo: 'injury',
        fechaBaja: '2026-02-01',
      }),
    )
    expect(baja).toMatchObject({ changed: true, current: 'baja', before: { estado: 'activa' } })
    const noop = await winner.db.transaction((tx) =>
      applyTransition(tx, { ...input, target: 'baja', expectedEstado: 'pendiente' }),
    )
    expect(noop).toMatchObject({ changed: false, current: 'baja' })
    const active = await winner.db.transaction((tx) =>
      applyTransition(tx, { ...input, target: 'activa', expectedEstado: 'baja' }),
    )
    expect(active.after).toMatchObject({
      estado: 'activa',
      baja_motivo: 'injury',
      fecha_baja: '2026-02-01',
    })
    const pendingBaja = await winner.db.transaction((tx) =>
      applyTransition(tx, {
        ...input,
        id: 'i-2',
        target: 'baja',
        motivo: 'injury',
        fechaBaja: '2026-02-01',
      }),
    )
    expect(pendingBaja).toMatchObject({
      changed: true,
      before: { estado: 'pendiente' },
      current: 'baja',
    })
  })

  it('returns typed validation, not-found, and stale transition errors', async () => {
    await expect(
      winner.db.transaction((tx) =>
        applyTransition(tx, { ...input, id: 'missing', target: 'activa' }),
      ),
    ).rejects.toMatchObject({ kind: 'notFound' })
    await expect(
      winner.db.transaction((tx) =>
        applyTransition(tx, {
          ...input,
          target: 'baja',
          expectedEstado: 'pendiente',
          motivo: 'injury',
          fechaBaja: '2026-02-01',
        }),
      ),
    ).rejects.toMatchObject({ kind: 'conflict' })
    await expect(
      winner.db.transaction((tx) =>
        applyTransition(tx, { ...input, target: 'baja', expectedEstado: 'activa' }),
      ),
    ).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('inscription receipt transactions', () => {
  it('replays a committed winner DTO to a two-connection follower', async () => {
    const barrier = createBarrier()
    const first = executeInscriptionReceipt(winner.db, table, command, async () => {
      await barrier.wait()
      return { inscripcionId: 'i-1', result: { id: 'i-1', changed: true } }
    })
    await barrier.entered
    const second = executeInscriptionReceipt(follower.db, table, command, async () => {
      throw new Error('follower must not execute')
    })
    barrier.release()
    await expect(first).resolves.toMatchObject({ outcome: 'executed', result: { changed: true } })
    await expect(second).resolves.toEqual({
      outcome: 'replayed',
      result: { id: 'i-1', changed: true },
    })
  })

  it('bounds a follower claim while the winner receipt is uncommitted', async () => {
    const barrier = createBarrier()
    const held = { ...command, callerKey: 'key-held' }
    const first = executeInscriptionReceipt(winner.db, table, held, async () => {
      await barrier.wait()
      return { result: { id: 'i-held', changed: true } }
    })
    await barrier.entered
    const second = executeInscriptionReceipt(follower.db, table, held, async () => ({ result: {} }))
    try {
      await expect(within(second)).resolves.toEqual({ outcome: 'unavailable' })
    } finally {
      barrier.release()
      await Promise.all([first, second])
    }
  })

  it('returns stable conflicts for a changed payload, command, or endpoint', async () => {
    for (const changed of [
      { ...command, payload: { socioId: 'socio-2' } },
      { ...command, command: 'baja' },
      { ...command, endpoint: '/inscripciones/i-1/baja' },
    ]) {
      await expect(
        executeInscriptionReceipt(follower.db, table, changed, async () => ({ result: {} })),
      ).resolves.toEqual({ outcome: 'conflict' })
    }
  })

  it('recovers after a winner rollback without indefinite retry', async () => {
    const rollback = { ...command, callerKey: 'key-rollback' }
    await expect(
      executeInscriptionReceipt(winner.db, table, rollback, async () => {
        throw new Error('abort winner')
      }),
    ).rejects.toThrow('abort winner')
    await expect(
      executeInscriptionReceipt(follower.db, table, rollback, async () => ({
        inscripcionId: 'i-2',
        result: { id: 'i-2', changed: true },
      })),
    ).resolves.toMatchObject({ outcome: 'executed' })
    const count = await winner.pool.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE caller_key = $1`,
      [rollback.callerKey],
    )
    expect(count.rows[0]?.count).toBe(1)
  })
})
