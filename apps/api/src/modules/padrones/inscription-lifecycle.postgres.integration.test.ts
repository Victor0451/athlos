import { randomUUID } from 'node:crypto'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeInscriptionReceipt } from './inscription-repository.ts'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
const table = `receipt_test_${randomUUID().replaceAll('-', '')}`
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
})

afterAll(async () => {
  await winner.pool.query(`DROP TABLE IF EXISTS ${table}`)
  await Promise.all([winner.pool.end(), follower.pool.end()])
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
