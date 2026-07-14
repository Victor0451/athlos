import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Db } from '@athlos/db'
import { createStandinDb } from '../../test-standins/db.ts'
import { LocalFileStorage } from '../file-storage/index.ts'
import * as repo from './attachments-repository.ts'
import * as service from './attachments.ts'

/**
 * S3.foundation / PR 5 — safe attachment compensation primitive.
 * 4 RED cases per `reviews/s3-foundation-replan.md`:
 *   1. Row hard-deleted via `remove(tx, id)` (not softDelete).
 *   2. File unlinked via the hard-deleted row's `storagePath`.
 *   3. Idempotent retry — no extra `storage.unlink` call.
 *   4. Prior attachments for the same socio are NEVER touched.
 */

const SOCIO_A = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'

let standin: ReturnType<typeof createStandinDb>
let baseDir: string
let storage: LocalFileStorage

beforeEach(() => {
  standin = createStandinDb()
  baseDir = mkdtempSync(join(tmpdir(), 'athlos-s3f-'))
  storage = new LocalFileStorage({ baseDir, maxBytes: 1024 * 1024 })
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

async function seed(
  db: Db,
  opts: { filename?: string; socioId?: string } = {},
): Promise<{ id: string; storagePath: string }> {
  const socioId = opts.socioId ?? SOCIO_A
  const filename = opts.filename ?? 'x.jpg'
  const storagePath = `socios/${socioId}/${filename}`
  const inserted = await repo.insert(db, {
    socioId,
    filename,
    description: null,
    category: 'dni',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    storagePath,
    storageSha256: 'a'.repeat(64),
    uploadedBy: OPERATOR_ID,
  })
  mkdirSync(join(baseDir, storagePath, '..'), { recursive: true })
  writeFileSync(join(baseDir, storagePath), 'pdf-bytes')
  return { id: inserted.id, storagePath }
}

describe('repo.remove — hard-delete primitive', () => {
  it('hard-deletes the row regardless of deleted_at and returns its storage path', async () => {
    const db = standin.drizzle as unknown as Db
    const { id, storagePath } = await seed(db, { filename: 'a.jpg' })
    expect(await repo.remove(db, id)).toMatchObject({ id, storagePath })
    expect(await repo.findById(db, id)).toBeNull()
  })

  it('returns null when the id is absent (idempotent on retry)', async () => {
    const db = standin.drizzle as unknown as Db
    expect(await repo.remove(db, '00000000-0000-4000-8000-000000000099')).toBeNull()
  })
})

describe('compensateNewAttachment — row + file compensation', () => {
  it('hard-deletes the row (not softDelete) and unlinks the file', async () => {
    const db = standin.drizzle as unknown as Db
    const { id, storagePath } = await seed(db, { filename: 'new.jpg' })
    expect(existsSync(join(baseDir, storagePath))).toBe(true)

    await service.compensateNewAttachment(db as never, id, storage)

    // Row is GONE — not soft-deleted.
    expect(await repo.findById(db, id)).toBeNull()
    // File is GONE from disk.
    expect(existsSync(join(baseDir, storagePath))).toBe(false)
  })

  it('commits the hard delete before unlinking the file', async () => {
    const { id } = await seed(standin.drizzle as unknown as Db, {
      filename: 'ordered.jpg',
    })
    let committed = false
    let unlinkedAfterCommit = false
    const db = {
      ...standin.drizzle,
      transaction: async (fn: (tx: typeof standin.drizzle) => Promise<unknown>) => {
        const result = await fn(standin.drizzle)
        committed = true
        return result
      },
    }
    const unlink = storage.unlink.bind(storage)
    vi.spyOn(storage, 'unlink').mockImplementation(async (path) => {
      unlinkedAfterCommit = committed
      return unlink(path)
    })

    await service.compensateNewAttachment(db as unknown as Db, id, storage)

    expect(unlinkedAfterCommit).toBe(true)
  })

  it('idempotent retry — second call is a no-op and does NOT call storage.unlink again', async () => {
    const db = standin.drizzle as unknown as Db
    const { id, storagePath } = await seed(db, { filename: 'new.jpg' })
    const unlinkSpy = vi.spyOn(storage, 'unlink')

    await service.compensateNewAttachment(db as never, id, storage)
    expect(unlinkSpy).toHaveBeenCalledTimes(1)
    expect(unlinkSpy).toHaveBeenCalledWith(storagePath)

    // Second call: row absent, file absent → unlink MUST NOT fire again.
    await service.compensateNewAttachment(db as never, id, storage)
    expect(unlinkSpy).toHaveBeenCalledTimes(1)
  })

  it('prior attachments for the same socio are NEVER touched', async () => {
    const db = standin.drizzle as unknown as Db
    const prior = await seed(db, { filename: 'prior.jpg', socioId: SOCIO_A })
    const current = await seed(db, { filename: 'new.jpg', socioId: SOCIO_A })

    await service.compensateNewAttachment(db as never, current.id, storage)

    // Current row + file gone.
    expect(await repo.findById(db, current.id)).toBeNull()
    expect(existsSync(join(baseDir, current.storagePath))).toBe(false)
    // Prior row + file untouched.
    expect((await repo.findById(db, prior.id))?.id).toBe(prior.id)
    expect(existsSync(join(baseDir, prior.storagePath))).toBe(true)
  })

  it('derives the unlink path from the deleted row, not a mismatched attachment', async () => {
    const db = standin.drizzle as unknown as Db
    const current = await seed(db, { filename: 'current.jpg' })
    const mismatched = await seed(db, { filename: 'mismatched.jpg' })
    const unlinkSpy = vi.spyOn(storage, 'unlink')

    await service.compensateNewAttachment(db as never, current.id, storage)

    expect(unlinkSpy).toHaveBeenCalledWith(current.storagePath)
    expect(existsSync(join(baseDir, mismatched.storagePath))).toBe(true)
  })
})
