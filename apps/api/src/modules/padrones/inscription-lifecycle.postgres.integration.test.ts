import { randomUUID } from 'node:crypto'
import { emitAudit } from '@athlos/audit'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  executeCreateInscription,
  executeTransitionInscription,
} from './inscription-command-service.ts'
import { executeInscriptionReceipt } from './inscription-repository.ts'
import { applyCreate, applyTransition } from './inscription-service.ts'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
const schema = `lifecycle_audit_${randomUUID().replaceAll('-', '')}`
const table = `receipt_test_${randomUUID().replaceAll('-', '')}`
const lifecycle = `lifecycle_test_${randomUUID().replaceAll('-', '')}`
const references = `reference_test_${randomUUID().replaceAll('-', '')}`
let winner: ReturnType<typeof createDb>
let follower: ReturnType<typeof createDb>

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`

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
  await winner.pool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`)
  await Promise.all(
    [winner, follower].map(({ pool }) =>
      pool.query(`SET search_path TO ${quoteIdentifier(schema)}, public`),
    ),
  )
  await winner.pool.query(`CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
    old_value jsonb, new_value jsonb, source_ip text, metadata jsonb, idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
  )`)
  await winner.pool.query(
    'CREATE UNIQUE INDEX uq_audit_events_idempotency_key ON audit_events(idempotency_key) WHERE idempotency_key IS NOT NULL',
  )
  await winner.pool.query(
    `CREATE TABLE ${table} (operator_id text NOT NULL, caller_key text NOT NULL, command text NOT NULL, request_fingerprint text NOT NULL, inscripcion_id text, result jsonb, PRIMARY KEY (operator_id, caller_key))`,
  )
  await winner.pool.query(`CREATE TABLE ${references} (id text PRIMARY KEY)`)
  await winner.pool.query(
    `INSERT INTO ${references} VALUES ('s-1'), ('s-2'), ('s-3'), ('s-4'), ('d-1'), ('e-1')`,
  )
  await winner.pool.query(
    `CREATE TABLE ${lifecycle} (id text PRIMARY KEY, socio_id text NOT NULL REFERENCES ${references}, disciplina_id text NOT NULL REFERENCES ${references}, ejercicio_id text NOT NULL REFERENCES ${references}, fecha_alta date NOT NULL, estado text NOT NULL, baja_motivo text, fecha_baja date, UNIQUE (socio_id, disciplina_id, ejercicio_id))`,
  )
})

afterAll(async () => {
  await winner.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`)
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

describe('inscription command audit facade', () => {
  const context = { operatorId: '00000000-0000-4000-8000-000000000001', sourceIp: '127.0.0.1' }
  const auditCount = (id: string) =>
    winner.pool.query(`SELECT count(*)::int AS count FROM audit_events WHERE entity_id = $1`, [id])

  it('commits one create event with owned context and replays without another event', async () => {
    const input = {
      ...context,
      callerKey: 'audit-create',
      table: lifecycle,
      receiptTable: table,
      id: 'audit-create-id',
      socioId: 's-3',
      disciplinaId: 'd-1',
      ejercicioId: 'e-1',
      fechaAlta: '2026-03-01',
      estado: 'activa' as const,
    }
    const first = await executeCreateInscription(winner.db, input)
    const replay = await executeCreateInscription(follower.db, input)

    expect(first).toMatchObject({ outcome: 'executed', result: { changed: true } })
    expect(replay).toMatchObject({ outcome: 'replayed', result: { changed: true } })
    await expect(auditCount(input.id)).resolves.toMatchObject({ rows: [{ count: 1 }] })
    await expect(
      winner.pool.query(
        `SELECT action, source_ip, metadata FROM audit_events WHERE entity_id = $1`,
        [input.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          action: 'INSCRIPCION_CREATED',
          source_ip: '127.0.0.1',
          metadata: { socioId: 's-3', disciplinaId: 'd-1', ejercicioId: 'e-1' },
        },
      ],
    })
  })

  it('emits no status event for a locked same-state command', async () => {
    const input = {
      ...context,
      callerKey: 'audit-noop',
      table: lifecycle,
      receiptTable: table,
      id: 'i-1',
      target: 'activa' as const,
      expectedEstado: 'baja' as const,
    }
    const result = await executeTransitionInscription(winner.db, input)

    expect(result).toMatchObject({ outcome: 'executed', result: { changed: false } })
    await expect(auditCount(input.id)).resolves.toMatchObject({ rows: [{ count: 0 }] })
  })

  it('rolls back the receipt and write when its audit event is deduplicated', async () => {
    const input = {
      ...context,
      callerKey: 'audit-failure',
      table: lifecycle,
      receiptTable: table,
      id: 'audit-failure-id',
      socioId: 's-4',
      disciplinaId: 'd-1',
      ejercicioId: 'e-1',
      fechaAlta: '2026-03-01',
      estado: 'activa' as const,
    }
    await emitAudit(winner.db, {
      operatorId: input.operatorId,
      action: 'INSCRIPCION_CREATED',
      entityType: 'inscripcion',
      entityId: input.id,
      oldValue: null,
      newValue: null,
      sourceIp: input.sourceIp,
      payload: null,
      metadata: {},
      callerKey: input.callerKey,
    })

    await expect(executeCreateInscription(winner.db, input)).rejects.toThrow(
      'inscription audit event was not inserted',
    )
    await expect(
      winner.pool.query(`SELECT count(*)::int AS count FROM ${lifecycle} WHERE id = $1`, [
        input.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] })
    await expect(
      winner.pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE caller_key = $1`, [
        input.callerKey,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] })
  })
})
