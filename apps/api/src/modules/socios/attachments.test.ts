import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { createStandinDb } from '../../test-standins/db.ts'
import { LocalFileStorage } from '../file-storage/index.ts'
import * as service from './attachments.ts'
import * as repo from './attachments-repository.ts'
import * as socioRepo from './repository.ts'
import type { Db } from '@athlos/db'

/**
 * `attachments` service tests — PR 8c.1 (athlos-socio-legajo).
 *
 * Covers:
 *   1. Happy path: write to disk, INSERT row, audit emission.
 *   2. Quota: 100 files OR 500 MB caps.
 *   3. Magic-byte rejection + rollback (file unlinked, row deleted).
 *   4. Soft delete + audit.
 *   5. Concurrency: two parallel `uploadAttachment` calls at the
 *      cap; one wins, one rejects with `QuotaError`.
 *
 * The standin's transaction doesn't model FOR SHARE locking — the
 * concurrency test uses a custom mock db that serializes the two
 * transactions deterministically (see `serializingDb` below).
 */

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const SOCIO_ID_2 = '22222222-2222-4222-8222-222222222222'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'

let standin: ReturnType<typeof createStandinDb>
let baseDir: string
let storage: LocalFileStorage

beforeEach(() => {
  standin = createStandinDb()
  baseDir = mkdtempSync(join(tmpdir(), 'athlos-svc-'))
  storage = new LocalFileStorage({ baseDir, maxBytes: 1024 * 1024 })
  // Seed a socio so the existence check passes.
  standin.state.socios.push({
    id: SOCIO_ID,
    numeroSocio: '0001',
    nombre: 'Test',
    apellido: 'Socio',
    dni: '11111111',
    fechaAlta: '2024-01-01',
    estado: 'activo',
    categoria: null,
    direccion: null,
    telefono: null,
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never)
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

function bufferStream(buf: Buffer): Readable {
  return Readable.from(buf)
}

function jpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
}

function pdfBuffer(): Buffer {
  const head = Buffer.from('%PDF-1.7\n', 'binary')
  const body = Buffer.alloc(50, 0x20)
  const tail = Buffer.from('%%EOF\n', 'binary')
  return Buffer.concat([head, body, tail])
}

describe('uploadAttachment — happy path', () => {
  it('writes the file, inserts the row, and emits SOCIO_ATTACHMENT_UPLOADED', async () => {
    const db = standin.drizzle as unknown as Db
    const row = await service.uploadAttachment({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      fileStream: bufferStream(jpegBuffer()),
      declaredMimeType: 'image/jpeg',
      filename: 'front.jpg',
      description: 'DNI frente',
      category: 'dni',
      db,
      storage,
    })

    expect(row.id).toEqual(expect.any(String))
    expect(row.filename).toBe('front.jpg')
    expect(row.category).toBe('dni')
    expect(row.mimeType).toBe('image/jpeg')
    expect(row.sizeBytes).toBe(jpegBuffer().length)
    expect(existsSync(join(baseDir, row.storagePath))).toBe(true)

    // Storage SHA-256 is the file bytes' hash.
    const onDisk = readFileSync(join(baseDir, row.storagePath))
    expect(row.storageSha256).toBe(createHash('sha256').update(onDisk).digest('hex'))

    // Audit row emitted.
    const audits = standin.state.auditEvents.filter((a) => a.action === 'SOCIO_ATTACHMENT_UPLOADED')
    expect(audits).toHaveLength(1)
    expect(audits[0]!.metadata).toEqual({
      attachment_id: row.id,
      filename: 'front.jpg',
      category: 'dni',
      size_bytes: jpegBuffer().length,
    })
    expect(audits[0]!.entityId).toBe(row.id)
  })

  it('throws NOT_FOUND when the socio does not exist (no disk write, no audit)', async () => {
    const db = standin.drizzle as unknown as Db
    await expect(
      service.uploadAttachment({
        socioId: SOCIO_ID_2, // not seeded
        operatorId: OPERATOR_ID,
        fileStream: bufferStream(jpegBuffer()),
        declaredMimeType: 'image/jpeg',
        filename: 'x.jpg',
        category: 'dni',
        db,
        storage,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // Nothing written, nothing audited.
    const audits = standin.state.auditEvents.filter((a) => a.action.startsWith('SOCIO_ATTACHMENT_'))
    expect(audits).toHaveLength(0)
  })
})

describe('uploadAttachment — magic-byte rejection + rollback', () => {
  it('rejects declared JPEG whose actual bytes are PDF — file unlinked + row deleted', async () => {
    const db = standin.drizzle as unknown as Db
    const beforeCount = standin.state.socioAttachments.length

    await expect(
      service.uploadAttachment({
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        fileStream: bufferStream(pdfBuffer()),
        declaredMimeType: 'image/jpeg', // ← client lies
        filename: 'carnet.jpg',
        category: 'dni',
        db,
        storage,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { detected: 'image/jpeg', allowed: expect.any(Array) },
    })

    // No DB row inserted.
    expect(standin.state.socioAttachments).toHaveLength(beforeCount)
    // No audit row emitted.
    expect(
      standin.state.auditEvents.filter((a) => a.action === 'SOCIO_ATTACHMENT_UPLOADED'),
    ).toHaveLength(0)
    // No leftover file on disk. (The `socios/` parent directory may
    // exist — it's created by the storage layer; the assertion is
    // about the file being unlinked after the magic-byte rejection.)
    const onDisk: string[] = []
    function walk(dir: string): void {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else onDisk.push(p)
      }
    }
    try {
      walk(baseDir)
    } catch (err) {
      // baseDir may have been cleaned up; treat as no files.
      if ((err as { code?: string }).code !== 'ENOENT') throw err
    }
    void statSync // keep import live for the strict TS check
    expect(onDisk).toEqual([])
  })
})

describe('uploadAttachment — quota caps', () => {
  it('rejects the 101st upload with QuotaError cap=files', async () => {
    const db = standin.drizzle as unknown as Db
    // Pre-fill 100 attachments for the socio.
    for (let i = 0; i < 100; i++) {
      await repo.insert(db, {
        socioId: SOCIO_ID,
        filename: `f-${i}.jpg`,
        description: null,
        category: 'dni',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        storagePath: `socios/${SOCIO_ID}/f-${i}.jpg`,
        storageSha256: 'a'.repeat(64),
        uploadedBy: OPERATOR_ID,
      })
    }
    await expect(
      service.uploadAttachment({
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        fileStream: bufferStream(jpegBuffer()),
        declaredMimeType: 'image/jpeg',
        filename: 'over-cap.jpg',
        category: 'dni',
        db,
        storage,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { cap: 'files' } })
    // Rejected attempt: no new row, no file, no audit.
    expect(standin.state.socioAttachments).toHaveLength(100)
    expect(
      standin.state.auditEvents.filter((a) => a.action === 'SOCIO_ATTACHMENT_UPLOADED'),
    ).toHaveLength(0)
  })

  it('rejects when the upload would push bytes over the 500 MB cap', async () => {
    const db = standin.drizzle as unknown as Db
    // Use a larger storage limit so the upload doesn't trip
    // SizeLimitError before the quota check fires.
    const bigStorage = new LocalFileStorage({ baseDir, maxBytes: 10 * 1024 * 1024 })
    // Pre-fill with one row at 499 MB.
    const large = 499 * 1024 * 1024
    await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'huge.bin',
      description: null,
      category: 'foto',
      mimeType: 'image/jpeg',
      sizeBytes: large,
      storagePath: `socios/${SOCIO_ID}/huge.bin`,
      storageSha256: 'b'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    // 4 MB JPEG upload → would exceed 500 MB cap. Real JPEG header
    // so the magic-byte check passes; only the bytes cap fires.
    const jpegHead = jpegBuffer()
    const filler = Buffer.alloc(4 * 1024 * 1024 - jpegHead.length, 0x20)
    const payload = Buffer.concat([jpegHead, filler])
    await expect(
      service.uploadAttachment({
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        fileStream: bufferStream(payload),
        declaredMimeType: 'image/jpeg',
        filename: 'over-bytes.jpg',
        category: 'foto',
        db,
        storage: bigStorage,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { cap: 'bytes' } })
  })
})

describe('uploadAttachment — concurrency (FOR SHARE race)', () => {
  it('exactly one of two simultaneous uploads wins; the other rejects with QuotaError', async () => {
    // The standin's transaction is non-blocking, so we wrap with a
    // serializer that processes one tx at a time. The first tx
    // sees count=99 (initial), passes quota, inserts (count=100),
    // commits. The second tx runs after, sees count=100, throws
    // QuotaError. This simulates the FOR SHARE semantics that the
    // production transaction provides at the DB layer.
    const baseDb = standin.drizzle as unknown as Db
    // Pre-fill 99 attachments.
    for (let i = 0; i < 99; i++) {
      await repo.insert(baseDb, {
        socioId: SOCIO_ID,
        filename: `pre-${i}.jpg`,
        description: null,
        category: 'dni',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        storagePath: `socios/${SOCIO_ID}/pre-${i}.jpg`,
        storageSha256: 'c'.repeat(64),
        uploadedBy: OPERATOR_ID,
      })
    }
    const db = makeSerializedTransactionDb(baseDb) as unknown as Db

    const results = await Promise.allSettled([
      service.uploadAttachment({
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        fileStream: bufferStream(jpegBuffer()),
        declaredMimeType: 'image/jpeg',
        filename: 'race-1.jpg',
        category: 'dni',
        db,
        storage,
      }),
      service.uploadAttachment({
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        fileStream: bufferStream(jpegBuffer()),
        declaredMimeType: 'image/jpeg',
        filename: 'race-2.jpg',
        category: 'dni',
        db,
        storage,
      }),
    ])

    const winners = results.filter((r) => r.status === 'fulfilled')
    const losers = results.filter((r) => r.status === 'rejected')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    // The losing call rejects with VALIDATION_ERROR (mapped from
    // QuotaError via `BusinessError`). Assert the typed shape.
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cap: 'files' },
    })

    // Final state: exactly 100 attachments (the initial 99 + 1 winner).
    const final = await repo.listBySocio(db as never, SOCIO_ID)
    expect(final).toHaveLength(100)
  })
})

describe('listAttachments / getAttachment / streamAttachment', () => {
  it('listAttachments returns the active rows for the socio', async () => {
    const db = standin.drizzle as unknown as Db
    await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'a.jpg',
      description: null,
      category: 'dni',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      storagePath: `socios/${SOCIO_ID}/a.jpg`,
      storageSha256: 'a'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    const items = await service.listAttachments({ socioId: SOCIO_ID, db: db as never })
    expect(items).toHaveLength(1)
    expect(items[0]!.filename).toBe('a.jpg')
  })

  it('listAttachments supports ?category= filter', async () => {
    const db = standin.drizzle as unknown as Db
    await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'dni.jpg',
      description: null,
      category: 'dni',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      storagePath: `socios/${SOCIO_ID}/dni.jpg`,
      storageSha256: 'd'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'foto.jpg',
      description: null,
      category: 'foto',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      storagePath: `socios/${SOCIO_ID}/foto.jpg`,
      storageSha256: 'e'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    const dniOnly = await service.listAttachments({
      socioId: SOCIO_ID,
      category: 'dni',
      db: db as never,
    })
    expect(dniOnly).toHaveLength(1)
    expect(dniOnly[0]!.filename).toBe('dni.jpg')
  })

  it('getAttachment returns null for an unknown id', async () => {
    const db = standin.drizzle as unknown as Db
    const got = await service.getAttachment('00000000-0000-4000-8000-000000000099', db as never)
    expect(got).toBeNull()
  })

  it('getAttachment returns the row when present', async () => {
    const db = standin.drizzle as unknown as Db
    const inserted = await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'a.jpg',
      description: null,
      category: 'dni',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      storagePath: `socios/${SOCIO_ID}/a.jpg`,
      storageSha256: 'a'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    const got = await service.getAttachment(inserted.id, db as never)
    expect(got?.id).toBe(inserted.id)
  })

  it('streamAttachment returns the row + a Readable when present', async () => {
    const db = standin.drizzle as unknown as Db
    const payload = jpegBuffer()
    await storage.saveStream(bufferStream(payload), {
      storagePath: `socios/${SOCIO_ID}/stream.jpg`,
      mimeType: 'image/jpeg',
    })
    const inserted = await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'stream.jpg',
      description: null,
      category: 'dni',
      mimeType: 'image/jpeg',
      sizeBytes: payload.length,
      storagePath: `socios/${SOCIO_ID}/stream.jpg`,
      storageSha256: createHash('sha256').update(payload).digest('hex'),
      uploadedBy: OPERATOR_ID,
    })
    const found = await service.streamAttachment(inserted.id, db as never, storage)
    expect(found).not.toBeNull()
    expect(found!.row.id).toBe(inserted.id)
    const chunks: Buffer[] = []
    for await (const chunk of found!.stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).equals(payload)).toBe(true)
  })

  it('streamAttachment returns null for a missing id', async () => {
    const db = standin.drizzle as unknown as Db
    const got = await service.streamAttachment(
      '00000000-0000-4000-8000-000000000099',
      db as never,
      storage,
    )
    expect(got).toBeNull()
  })
})

describe('softDeleteAttachment', () => {
  it('soft-deletes the row + emits SOCIO_ATTACHMENT_DELETED with full metadata', async () => {
    const db = standin.drizzle as unknown as Db
    const inserted = await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'del.jpg',
      description: 'a',
      category: 'dni',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      storagePath: `socios/${SOCIO_ID}/del.jpg`,
      storageSha256: 'a'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    await service.softDeleteAttachment({
      id: inserted.id,
      operatorId: OPERATOR_2_DELETE,
      db: db as never,
    })
    // Row soft-deleted.
    const after = await repo.findById(db, inserted.id)
    expect(after?.deletedAt).toBeInstanceOf(Date)
    expect(after?.deletedBy).toBe(OPERATOR_2_DELETE)
    // Audit row emitted with full metadata.
    const audits = standin.state.auditEvents.filter((a) => a.action === 'SOCIO_ATTACHMENT_DELETED')
    expect(audits).toHaveLength(1)
    expect(audits[0]!.metadata).toEqual({
      attachment_id: inserted.id,
      filename: 'del.jpg',
      category: 'dni',
      size_bytes: 100,
    })
  })

  it('is idempotent — second delete is a no-op (no extra audit row)', async () => {
    const db = standin.drizzle as unknown as Db
    const inserted = await repo.insert(db, {
      socioId: SOCIO_ID,
      filename: 'del.jpg',
      description: null,
      category: 'dni',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      storagePath: `socios/${SOCIO_ID}/del.jpg`,
      storageSha256: 'a'.repeat(64),
      uploadedBy: OPERATOR_ID,
    })
    await service.softDeleteAttachment({
      id: inserted.id,
      operatorId: OPERATOR_2_DELETE,
      db: db as never,
    })
    await service.softDeleteAttachment({
      id: inserted.id,
      operatorId: OPERATOR_2_DELETE,
      db: db as never,
    })
    const audits = standin.state.auditEvents.filter((a) => a.action === 'SOCIO_ATTACHMENT_DELETED')
    expect(audits).toHaveLength(1)
  })
})

const OPERATOR_2_DELETE = '00000000-0000-4000-8000-000000000002'

/**
 * Wrap a Drizzle-like db with a transaction wrapper that serializes
 * concurrent tx invocations. The first tx runs to completion before
 * the second starts — mimicking the FOR SHARE block semantics in
 * production (where the second tx blocks until the first commits).
 *
 * Non-transaction calls (select / insert / update outside tx) pass
 * straight through to the underlying db.
 */
function makeSerializedTransactionDb(baseDb: unknown): unknown {
  const base = baseDb as { transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }
  let chain: Promise<unknown> = Promise.resolve()
  // Replace `.transaction` with a queueing wrapper. We pass the
  // SAME `base` to the callback so its internal drizzle interface
  // (the `tx`) shares the standin's mutable `state.socioAttachments`
  // array — that's the whole point: tx1's INSERT is visible to tx2's
  // quota query.
  const wrapped = {
    ...(base as Record<string, unknown>),
    transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const next = chain.then(() => fn(base))
      chain = next.catch(() => undefined)
      return next as Promise<T>
    },
  }
  return wrapped
}

// Avoid lint complaints about unused imports that are still used by
// tree-shake / future expansion.
void socioRepo
void vi
