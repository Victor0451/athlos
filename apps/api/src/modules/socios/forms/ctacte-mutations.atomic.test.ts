import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createDb, type Db } from '@athlos/db'
import * as schema from '@athlos/db/schema'
import * as audit from '@athlos/audit'
import * as socioAttachmentsModule from '../../socios/attachments.ts'
import * as socioRepo from '../../socios/repository.ts'
import { LocalFileStorage } from '../../file-storage/index.ts'
import { registerDebit, registerPayment } from './ctacte-mutations.ts'

/**
 * Transactional registerPayment and registerDebit proof against disposable
 * PostgreSQL. Each ledger insert and audit event commit together or roll back
 * together; payment additionally compensates its newly uploaded comprobante.
 */

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
const SUFFIX = randomBytes(6).toString('hex')
const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const SOCIOS = `socios_s2c_${SUFFIX}`
const TESORERIA = `tesoreria_s2c_${SUFFIX}`

interface RawPool {
  query: (this: unknown, ...args: unknown[]) => unknown
  connect: () => Promise<Pool>
}

const rewriteSql = (sql: string): string =>
  sql
    .replaceAll('"socios".', `"${SOCIOS}".`)
    .replaceAll('"tesoreria".', `"${TESORERIA}".`)
    .replaceAll('socios.', `${SOCIOS}.`)
    .replaceAll('tesoreria.', `${TESORERIA}.`)

const wrapPool = (pool: Pool): Pool => {
  const wrapQuery = (target: RawPool) =>
    function (...args: unknown[]): unknown {
      const [config, ...rest] = args
      if (typeof config === 'string') return target.query.call(target, rewriteSql(config), ...rest)
      if (config && typeof config === 'object' && 'text' in (config as Record<string, unknown>)) {
        const query = config as { text: string } & Record<string, unknown>
        return target.query.call(target, { ...query, text: rewriteSql(query.text) }, ...rest)
      }
      return target.query.call(target, config, ...rest)
    }
  const wrapConnect = (target: RawPool) => async (): Promise<Pool> => {
    const client = await target.connect()
    await (client.query as (query: string) => Promise<unknown>)(
      `SET search_path TO "${SOCIOS}", "${TESORERIA}", public`,
    )
    return wrapPool(client)
  }
  return new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'query') return wrapQuery(target as unknown as RawPool)
      if (property === 'connect') return wrapConnect(target as unknown as RawPool)
      return Reflect.get(target, property, receiver)
    },
  }) as Pool
}

let realPool: Pool | undefined
let db: Db | undefined
let storageDir: string
let storage: LocalFileStorage

beforeAll(async () => {
  if (!databaseUrl) throw new Error('ATHLOS_TEST_DATABASE_URL required')
  const handle = createDb({ connectionString: databaseUrl })
  realPool = handle.pool
  await realPool.query('SELECT 1')
  await realPool.query(`DROP SCHEMA IF EXISTS "${TESORERIA}" CASCADE`)
  await realPool.query(`DROP SCHEMA IF EXISTS "${SOCIOS}" CASCADE`)
  await realPool.query(`CREATE SCHEMA "${TESORERIA}"`)
  await realPool.query(`CREATE SCHEMA "${SOCIOS}"`)
  for (const statement of [
    `CREATE TABLE "${SOCIOS}"."socios" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      numero_socio text NOT NULL, nombre text NOT NULL, apellido text NOT NULL,
      dni text NOT NULL, fecha_alta date NOT NULL, estado varchar(16) NOT NULL,
      categoria text, direccion text, telefono text, email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`,
    `CREATE TYPE "${SOCIOS}"."attachment_category" AS ENUM ('dni','comprobante','foto','contrato','otro')`,
    `CREATE TABLE "${SOCIOS}"."socio_attachments" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL, filename text NOT NULL, description text,
      category "${SOCIOS}"."attachment_category" NOT NULL,
      mime_type text NOT NULL, size_bytes bigint NOT NULL,
      storage_path text NOT NULL, storage_sha256 text NOT NULL,
      uploaded_by uuid NOT NULL, uploaded_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz, deleted_by uuid
    )`,
    `CREATE TABLE "${TESORERIA}"."ctacte" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL, fecha date NOT NULL, tipo varchar(16) NOT NULL,
      concepto text NOT NULL DEFAULT '',
      debe numeric(14,2) NOT NULL DEFAULT 0, haber numeric(14,2) NOT NULL DEFAULT 0,
      anulado boolean NOT NULL DEFAULT false, anulado_at timestamptz, anulado_motivo text,
      cctcuenta text, legacy_id text, comprobante_attachment_id uuid,
      idempotency_key text, idempotency_operator_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX "ctacte_idem_${SUFFIX}" ON "${TESORERIA}"."ctacte" ("idempotency_key")`,
  ])
    await realPool.query(statement)
  db = drizzle(wrapPool(realPool), { schema }) as Db
  storageDir = mkdtempSync(join(tmpdir(), 'athlos-s2c-'))
  storage = new LocalFileStorage({ baseDir: storageDir, maxBytes: 1024 * 1024 })
})

afterAll(async () => {
  if (realPool) {
    for (const schemaName of [TESORERIA, SOCIOS])
      await realPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {})
    await realPool.end().catch(() => {})
  }
  if (storageDir) rmSync(storageDir, { recursive: true, force: true })
})

beforeEach(async () => {
  if (!realPool) return
  await realPool.query(`DELETE FROM "${TESORERIA}"."ctacte"`)
  await realPool.query(`DELETE FROM "${SOCIOS}"."socio_attachments"`)
  await realPool.query('DELETE FROM "audit_events"')
  vi.restoreAllMocks()
})

afterEach(() => vi.restoreAllMocks())

const countRows = (table: string): Promise<number> =>
  realPool!
    .query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`)
    .then((result) => Number(result.rows[0]!.count))

async function seedComprobante() {
  if (!db) throw new Error('db not ready')
  const filename = `c-${SUFFIX}.pdf`
  const storagePath = `socios/${SOCIO_ID}/${filename}`
  mkdirSync(join(storageDir, storagePath, '..'), { recursive: true })
  writeFileSync(join(storageDir, storagePath), '%PDF-1.4\nmock\n')
  const [row] = await db
    .insert(schema.socioAttachments)
    .values({
      socioId: SOCIO_ID,
      filename,
      description: null,
      category: 'comprobante',
      mimeType: 'application/pdf',
      sizeBytes: 13,
      storagePath,
      storageSha256: 'a'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    .returning({ id: schema.socioAttachments.id })
  return { id: row!.id, storagePath, filename }
}

const stubUpload = (id: string, storagePath: string, filename: string) =>
  vi.spyOn(socioAttachmentsModule, 'uploadAttachment').mockResolvedValue({
    id,
    socioId: SOCIO_ID,
    filename,
    description: null,
    category: 'comprobante',
    mimeType: 'application/pdf',
    sizeBytes: 13,
    storagePath,
    storageSha256: 'a'.repeat(64),
    uploadedBy: OPERATOR_ID,
    uploadedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
  } as never)

describe('registerPayment — atomic audit + compensation (disposable PG)', () => {
  it('commits ctacte + audit atomically and keeps the comprobante', async () => {
    if (!db || !realPool) throw new Error('disposable PG not initialized')
    const seed = await seedComprobante()
    vi.spyOn(socioRepo, 'findById').mockResolvedValue({
      id: SOCIO_ID,
      fechaAlta: '2020-01-01',
    } as never)
    stubUpload(seed.id, seed.storagePath, seed.filename)

    const result = await registerPayment({
      db,
      storage,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 1500,
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
      comprobante: {
        bytes: Buffer.from('%PDF-1.4\n'),
        mimeType: 'application/pdf',
        filename: 'c.pdf',
      },
      idempotencyKey: `s2c-happy-${SUFFIX}`,
    })

    expect(result.tipo).toBe('CREDITO')
    expect(result.monto).toBe(1500)
    expect(result.comprobanteAttachmentId).toBe(seed.id)
    expect(await countRows(`"${TESORERIA}"."ctacte"`)).toBe(1)
    expect(await countRows('"audit_events"')).toBe(1)
    expect(await countRows(`"${SOCIOS}"."socio_attachments"`)).toBe(1)
    expect(existsSync(join(storageDir, seed.storagePath))).toBe(true)
  })

  it('rolls back ctacte and compensates the comprobante after an audit failure', async () => {
    if (!db || !realPool) throw new Error('disposable PG not initialized')
    const seed = await seedComprobante()
    vi.spyOn(socioRepo, 'findById').mockResolvedValue({
      id: SOCIO_ID,
      fechaAlta: '2020-01-01',
    } as never)
    stubUpload(seed.id, seed.storagePath, seed.filename)
    vi.spyOn(audit, 'emitAudit').mockImplementation(async () => {
      throw new Error('forced audit insert failure')
    })

    await expect(
      registerPayment({
        db,
        storage,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 500,
        fecha: '2026-07-09',
        concepto: 'Cuota Julio',
        comprobante: {
          bytes: Buffer.from('%PDF-1.4\n'),
          mimeType: 'application/pdf',
          filename: 'c.pdf',
        },
        idempotencyKey: `s2c-rollback-${SUFFIX}`,
      }),
    ).rejects.toThrow('forced audit insert failure')

    expect(await countRows(`"${TESORERIA}"."ctacte"`)).toBe(0)
    expect(await countRows('"audit_events"')).toBe(0)
    expect(await countRows(`"${SOCIOS}"."socio_attachments"`)).toBe(0)
    expect(existsSync(join(storageDir, seed.storagePath))).toBe(false)
    expect(audit.emitAudit).toHaveBeenCalledTimes(1)
  })
})

describe('registerDebit — atomic audit (disposable PG)', () => {
  it('commits the debit ledger row and matching audit event together', async () => {
    if (!db || !realPool) throw new Error('disposable PG not initialized')
    vi.spyOn(socioRepo, 'findById').mockResolvedValue({
      id: SOCIO_ID,
      fechaAlta: '2020-01-01',
    } as never)

    const result = await registerDebit({
      db,
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      monto: 900,
      fecha: '2026-07-09',
      motivo: 'Mora Julio',
      idempotencyKey: `s2e-happy-${SUFFIX}`,
    })

    expect(result).toMatchObject({ tipo: 'DEBITO', monto: 900, motivo: 'Mora Julio' })
    expect(await countRows(`"${TESORERIA}"."ctacte"`)).toBe(1)
    expect(await countRows('"audit_events"')).toBe(1)
  })

  it('rolls back the debit ledger row when audit emission fails', async () => {
    if (!db || !realPool) throw new Error('disposable PG not initialized')
    vi.spyOn(socioRepo, 'findById').mockResolvedValue({
      id: SOCIO_ID,
      fechaAlta: '2020-01-01',
    } as never)
    vi.spyOn(audit, 'emitAudit').mockRejectedValue(new Error('forced debit audit failure'))

    await expect(
      registerDebit({
        db,
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        monto: 950,
        fecha: '2026-07-09',
        motivo: 'Mora Agosto',
        idempotencyKey: `s2e-rollback-${SUFFIX}`,
      }),
    ).rejects.toThrow('forced debit audit failure')

    expect(await countRows(`"${TESORERIA}"."ctacte"`)).toBe(0)
    expect(await countRows('"audit_events"')).toBe(0)
    expect(await countRows(`"${SOCIOS}"."socio_attachments"`)).toBe(0)
    expect(audit.emitAudit).toHaveBeenCalledTimes(1)
  })
})
