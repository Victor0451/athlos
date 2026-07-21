import { randomBytes } from 'node:crypto'
import { createDb, type Db } from '@athlos/db'
import * as dbSchema from '@athlos/db/schema'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import {
  createPostgresComprobanteLeaseStore,
  type ComprobanteLeaseStore,
  type RenderComprobanteResult,
} from './ctacte-comprobante.ts'
export interface RetrySnapshot {
  idempotency_key: string
  request_fingerprint: string
  status: string
  pdf_base64: string | null
  sha256: string | null
  byte_size: number | null
  filename: string | null
  movement_count: number | null
  failure_reason: string | null
  lease_owner: string | null
  lease_expires_at: Date | null
  attempt_count: number
  updated_at: Date
  expires_at: Date
  created_at: Date
}
export interface BoundedBarrier {
  entered: Promise<void>
  wait(): Promise<void>
  release(): void
}

interface QueryTarget {
  query(this: unknown, ...args: unknown[]): unknown
  connect(): Promise<Pool>
}

function assertOwnedSchema(schema: string): void {
  if (!/^tesoreria_s4b_[0-9a-f]{24}$/.test(schema)) throw new Error('refusing non-owned schema')
}

function rewriteSql(text: string, schema: string): string {
  return text.replaceAll('"tesoreria".', `"${schema}".`).replaceAll('tesoreria.', `${schema}.`)
}

function wrapPool(pool: Pool, schema: string): Pool {
  const query = (target: QueryTarget) =>
    function (this: unknown, ...args: unknown[]): unknown {
      const [config, ...rest] = args
      if (typeof config === 'string')
        return target.query.call(target, rewriteSql(config, schema), ...rest)
      if (config && typeof config === 'object' && 'text' in (config as Record<string, unknown>)) {
        const value = config as { text: string } & Record<string, unknown>
        return target.query.call(
          target,
          { ...value, text: rewriteSql(value.text, schema) },
          ...rest,
        )
      }
      return target.query.call(target, config, ...rest)
    }
  return new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'query') return query(target as unknown as QueryTarget)
      if (property === 'connect')
        return async () => wrapPool(await (target as unknown as QueryTarget).connect(), schema)
      return Reflect.get(target, property, receiver)
    },
  }) as Pool
}

async function assertTestDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{ name: string }>('SELECT current_database() AS name')
  const name = result.rows[0]?.name
  if (!name || !/_test$/.test(name))
    throw new Error(`refusing non-test database: ${name ?? 'unknown'}`)
}

function boundedDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createBoundedBarrier(timeoutMs: number): BoundedBarrier {
  let enter!: () => void
  let release!: () => void
  let released = false
  const enteredSignal = new Promise<void>((resolve) => (enter = resolve))
  const releaseSignal = new Promise<void>((resolve) => (release = resolve))
  const bounded = (promise: Promise<void>, message: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      void promise.then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  return {
    entered: bounded(enteredSignal, 'barrier entry timed out'),
    async wait() {
      enter()
      await bounded(releaseSignal, 'barrier release timed out')
    },
    release() {
      if (!released) {
        released = true
        release()
      }
    },
  }
}

export async function schemaExists(databaseUrl: string, schema: string): Promise<boolean> {
  const handle = createDb({ connectionString: databaseUrl })
  try {
    const result = await handle.pool.query<{ present: boolean }>(
      'SELECT to_regnamespace($1) IS NOT NULL AS present',
      [schema],
    )
    return result.rows[0]?.present === true
  } finally {
    await handle.pool.end()
  }
}

export async function createIsolatedComprobanteHarness(
  databaseUrl: string,
  options: { barrierTimeoutMs?: number } = {},
) {
  const schema = `tesoreria_s4b_${randomBytes(12).toString('hex')}`
  assertOwnedSchema(schema)
  const handles: ReturnType<typeof createDb>[] = []
  let schemaCreated = false
  let cleaned = false
  try {
    const owner = createDb({ connectionString: databaseUrl })
    handles.push(owner)
    await assertTestDatabase(owner.pool)
    await owner.pool.query(`CREATE SCHEMA "${schema}"`)
    schemaCreated = true
    await owner.pool.query(`CREATE TABLE "${schema}".ctacte_comprobante_retries (
      idempotency_key text PRIMARY KEY, request_fingerprint text NOT NULL, status text NOT NULL,
      pdf_base64 text, sha256 text, byte_size integer, filename text, movement_count integer,
      failure_reason text, lease_owner text, lease_expires_at timestamptz,
      attempt_count integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
    await owner.pool.query(`CREATE TABLE "${schema}".printed_audit (
      id bigserial PRIMARY KEY, idempotency_key text NOT NULL, entity_id text NOT NULL,
      action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
    const rival = createDb({ connectionString: databaseUrl })
    handles.push(rival)
    await assertTestDatabase(rival.pool)
    const ownerDb = drizzle(wrapPool(owner.pool, schema), { schema: dbSchema }) as Db
    const rivalDb = drizzle(wrapPool(rival.pool, schema), { schema: dbSchema }) as Db
    const ownerStore = createPostgresComprobanteLeaseStore(ownerDb)
    const rivalStore = createPostgresComprobanteLeaseStore(rivalDb)
    const barriers = new Set<BoundedBarrier>()
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      for (const barrier of barriers) barrier.release()
      try {
        if (schemaCreated) await owner.pool.query(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        await Promise.allSettled(handles.map((handle) => handle.pool.end()))
      }
    }
    return {
      schema,
      ownerStore,
      rivalStore,
      createBarrier: () => {
        const barrier = createBoundedBarrier(options.barrierTimeoutMs ?? 1_000)
        barriers.add(barrier)
        return barrier
      },
      async snapshot(key: string): Promise<RetrySnapshot | null> {
        const result = await owner.pool.query<RetrySnapshot>(
          `SELECT idempotency_key, request_fingerprint, status, pdf_base64, sha256, byte_size,
           filename, movement_count, failure_reason, lease_owner, lease_expires_at, attempt_count,
           updated_at, expires_at, created_at FROM "${schema}".ctacte_comprobante_retries
           WHERE idempotency_key = $1`,
          [key],
        )
        return result.rows[0] ?? null
      },
      async completeAndPublish(input: {
        store: ComprobanteLeaseStore
        key: string
        owner: string
        entityId: string
        result: RenderComprobanteResult
        barrier?: BoundedBarrier
      }): Promise<boolean> {
        await input.barrier?.wait()
        const completed = await input.store.complete(input.key, input.owner, input.result)
        if (!completed) return false
        await owner.pool.query(
          `INSERT INTO "${schema}".printed_audit (idempotency_key, entity_id, action)
           VALUES ($1, $2, $3)`,
          [input.key, input.entityId, 'CTACTE_COMPROBANTE_PRINTED'],
        )
        return true
      },
      async observePrintedAudit(input: {
        key: string
        entityId: string
        expectedCount: number
        timeoutMs: number
        pollMs: number
      }): Promise<number> {
        const deadline = Date.now() + input.timeoutMs
        let count = -1
        do {
          const result = await owner.pool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM "${schema}".printed_audit
             WHERE idempotency_key = $1 AND entity_id = $2 AND action = $3`,
            [input.key, input.entityId, 'CTACTE_COMPROBANTE_PRINTED'],
          )
          count = Number(result.rows[0]?.count ?? 0)
          if (input.expectedCount > 0 && count === input.expectedCount) return count
          await boundedDelay(Math.min(input.pollMs, Math.max(0, deadline - Date.now())))
        } while (Date.now() < deadline)
        if (count !== input.expectedCount)
          throw new Error(`printed audit count ${count}; expected ${input.expectedCount}`)
        return count
      },
      cleanup,
    }
  } catch (error) {
    if (schemaCreated && handles[0])
      await handles[0].pool.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined)
    await Promise.allSettled(handles.map((handle) => handle.pool.end()))
    throw error
  }
}
