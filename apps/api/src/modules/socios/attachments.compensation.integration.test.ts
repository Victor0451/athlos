import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { createDb, type Db } from '@athlos/db'
import { LocalFileStorage } from '../file-storage/index.ts'
import { compensateNewAttachment } from './attachments.ts'
import * as repo from './attachments-repository.ts'

/**
 * S3.foundation / PR 5 — INTEGRATION proof against disposable
 * PostgreSQL (gated on `ATHLOS_TEST_DATABASE_URL`, port 5563).
 *
 * Two RED cases per `reviews/s3-foundation-replan.md`:
 *   1. compensation commits its row delete before unlinking the file.
 *   2. a caller rollback after compensation cannot restore a row
 *      whose file was already unlinked.
 */

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
let db: { db: Db; pool: Pool } | undefined
let storageDir: string
let storage: LocalFileStorage

beforeAll(async () => {
  if (!databaseUrl)
    throw new Error(
      'ATHLOS_TEST_DATABASE_URL is required for attachments compensation PostgreSQL tests',
    )
  db = createDb({ connectionString: databaseUrl })
  await db.pool.query('SELECT 1')
  await db.pool.query('SET search_path TO "socios", "tesoreria", "public"')
  storageDir = mkdtempSync(join(tmpdir(), 'athlos-s3f-it-'))
  storage = new LocalFileStorage({ baseDir: storageDir, maxBytes: 1024 * 1024 })
})

afterAll(async () => {
  await db?.pool.end()
  if (storageDir) rmSync(storageDir, { recursive: true, force: true })
})

async function resetSchemas(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS "socios" CASCADE')
  await pool.query('DROP SCHEMA IF EXISTS "tesoreria" CASCADE')
  await pool.query('CREATE SCHEMA "socios"')
  // Mirror the production `socios` shape (PR 8d.1 added fechaNacimiento).
  await pool.query(`
    CREATE TABLE "socios"."socios" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      numero_socio text NOT NULL,
      nombre text NOT NULL,
      apellido text NOT NULL,
      dni text NOT NULL,
      fecha_alta date NOT NULL,
      fecha_nacimiento date,
      estado varchar(16) NOT NULL,
      categoria text,
      direccion text,
      telefono text,
      email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )
  `)
  await pool.query(`
    CREATE TYPE "socios"."attachment_category" AS ENUM
      ('dni', 'comprobante', 'foto', 'contrato', 'otro');
    CREATE TABLE "socios"."socio_attachments" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES "socios"."socios"(id) ON DELETE restrict,
      filename text NOT NULL,
      description text,
      category "socios"."attachment_category" NOT NULL,
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL,
      storage_path text NOT NULL,
      storage_sha256 text NOT NULL,
      uploaded_by uuid NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      deleted_by uuid,
      CONSTRAINT "socio_attachments_filename_length" CHECK (char_length(filename) <= 255),
      CONSTRAINT "socio_attachments_description_length" CHECK (description IS NULL OR char_length(description) <= 500),
      CONSTRAINT "socio_attachments_sha256_hex" CHECK (storage_sha256 ~ '^[0-9a-f]{64}$')
    );
  `)
  await pool.query(
    `INSERT INTO "socios"."socios"
       (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
     VALUES ($1, '0001', 'Test', 'Socio', '11111111', '2024-01-01', 'activo')`,
    [SOCIO_ID],
  )
}

beforeEach(async () => {
  if (!db) return
  await resetSchemas(db.pool)
})

async function seedRow(fileName: string): Promise<{ id: string; storagePath: string }> {
  const inserted = await repo.insert(db!.db, {
    socioId: SOCIO_ID,
    filename: fileName,
    description: null,
    category: 'comprobante',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    storagePath: `socios/${SOCIO_ID}/${fileName}`,
    storageSha256: 'a'.repeat(64),
    uploadedBy: OPERATOR_ID,
  })
  mkdirSync(join(storageDir, inserted.storagePath, '..'), { recursive: true })
  writeFileSync(join(storageDir, inserted.storagePath), 'pdf-bytes')
  return { id: inserted.id, storagePath: inserted.storagePath }
}

async function countRows(pool: Pool, id: string): Promise<number> {
  const r = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM "socios"."socio_attachments" WHERE id = $1',
    [id],
  )
  return Number(r.rows[0]!.count)
}

describe('compensateNewAttachment — integration proof against disposable PostgreSQL', () => {
  it('removes the row + file inside an open tx that COMMITS', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const seeded = await seedRow('comprobante.jpg')
    expect(await countRows(db.pool, seeded.id)).toBe(1)
    expect(existsSync(join(storageDir, seeded.storagePath))).toBe(true)

    await compensateNewAttachment(db.db, seeded.id, seeded.storagePath, storage)

    expect(await countRows(db.pool, seeded.id)).toBe(0)
    expect(existsSync(join(storageDir, seeded.storagePath))).toBe(false)
  })

  it('keeps the row deletion committed when a caller transaction rolls back', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const activeDb = db
    const seeded = await seedRow('rollback.jpg')
    expect(await countRows(activeDb.pool, seeded.id)).toBe(1)

    await expect(
      activeDb.db.transaction(async () => {
        await compensateNewAttachment(activeDb.db, seeded.id, seeded.storagePath, storage)
        throw new Error('force outer rollback')
      }),
    ).rejects.toThrow('force outer rollback')

    expect(await countRows(activeDb.pool, seeded.id)).toBe(0)
    expect(existsSync(join(storageDir, seeded.storagePath))).toBe(false)
  })
})
