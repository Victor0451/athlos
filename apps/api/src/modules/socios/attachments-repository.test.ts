import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@athlos/db'
import type { NewSocioAttachment } from '@athlos/db/schema'
import { createStandinDb } from '../../test-standins/db.ts'
import * as repo from './attachments-repository.ts'

/**
 * Repository tests — use the in-memory standin so the suite runs
 * in-process. The standin supports the `socio_attachments` table
 * (added in commit A.4) and the four repository functions under test.
 */

const SOCIO_A = '11111111-1111-4111-8111-111111111111'
const SOCIO_B = '22222222-2222-4222-8222-222222222222'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const OPERATOR_2 = '00000000-0000-4000-8000-000000000002'

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

function makeAttachment(over: Partial<NewSocioAttachment> = {}): NewSocioAttachment {
  return {
    socioId: SOCIO_A,
    filename: 'front.jpg',
    description: null,
    category: 'dni',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    storagePath: `socios/${SOCIO_A}/front.jpg`,
    storageSha256: 'a'.repeat(64),
    uploadedBy: OPERATOR_ID,
    ...over,
  }
}

describe('attachments-repository — insert + findById', () => {
  it('inserts a row and returns the persisted shape', async () => {
    const inserted = await repo.insert(db, makeAttachment({ filename: 'dni-front.jpg' }))
    expect(inserted.id).toEqual(expect.any(String))
    expect(inserted.filename).toBe('dni-front.jpg')
    expect(inserted.deletedAt).toBeNull()
    expect(inserted.deletedBy).toBeNull()
  })

  it('findById returns the row when present', async () => {
    const inserted = await repo.insert(db, makeAttachment({ filename: 'dni-back.jpg' }))
    const found = await repo.findById(db, inserted.id)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(inserted.id)
  })

  it('findById returns null when the id does not exist', async () => {
    const found = await repo.findById(db, '00000000-0000-4000-8000-000000000099')
    expect(found).toBeNull()
  })
})

describe('attachments-repository — listBySocio', () => {
  it('returns only the active rows for the socio', async () => {
    const a1 = await repo.insert(db, makeAttachment({ filename: 'a1.jpg' }))
    await repo.insert(db, makeAttachment({ filename: 'a2.jpg' }))
    const toDelete = await repo.insert(db, makeAttachment({ filename: 'to-delete.jpg' }))
    await repo.softDelete(db, toDelete.id, OPERATOR_2)

    const items = await repo.listBySocio(db, SOCIO_A)
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.filename).sort()).toEqual(['a1.jpg', 'a2.jpg'])
    expect(items.find((i) => i.id === a1.id)).toBeDefined()
    expect(items.find((i) => i.id === toDelete.id)).toBeUndefined()
  })

  it('returns both rows; production drizzle sorts by uploaded_at desc (the standin does not — DB index does)', async () => {
    await repo.insert(db, makeAttachment({ filename: 'old.jpg' }))
    await new Promise((r) => setTimeout(r, 5))
    const newer = await repo.insert(db, makeAttachment({ filename: 'new.jpg' }))
    const items = await repo.listBySocio(db, SOCIO_A)
    // The standin preserves insertion order; the production query is
    // `.orderBy(desc(uploadedAt))` and the migration creates an index
    // for it. Assert both rows come back with the right IDs.
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([newer.id]))
    expect(items).toHaveLength(2)
  })

  it('filters by ?category= when the option is set', async () => {
    await repo.insert(db, makeAttachment({ filename: 'dni.jpg', category: 'dni' }))
    await repo.insert(db, makeAttachment({ filename: 'comp.pdf', category: 'comprobante' }))
    await repo.insert(db, makeAttachment({ filename: 'foto.jpg', category: 'foto' }))

    const dniOnly = await repo.listBySocio(db, SOCIO_A, { category: 'dni' })
    expect(dniOnly).toHaveLength(1)
    expect(dniOnly[0]!.filename).toBe('dni.jpg')

    const comprobantes = await repo.listBySocio(db, SOCIO_A, { category: 'comprobante' })
    expect(comprobantes).toHaveLength(1)
    expect(comprobantes[0]!.filename).toBe('comp.pdf')
  })

  it('does not mix rows from a different socio', async () => {
    await repo.insert(db, makeAttachment({ socioId: SOCIO_A, filename: 'a.jpg' }))
    await repo.insert(db, makeAttachment({ socioId: SOCIO_B, filename: 'b.jpg' }))

    const itemsA = await repo.listBySocio(db, SOCIO_A)
    const itemsB = await repo.listBySocio(db, SOCIO_B)
    expect(itemsA).toHaveLength(1)
    expect(itemsA[0]!.filename).toBe('a.jpg')
    expect(itemsB).toHaveLength(1)
    expect(itemsB[0]!.filename).toBe('b.jpg')
  })

  it('returns an empty array when the socio has no attachments', async () => {
    const items = await repo.listBySocio(db, SOCIO_A)
    expect(items).toEqual([])
  })

  it('excludes soft-deleted rows by default; includeDeleted:true brings them back', async () => {
    const active = await repo.insert(db, makeAttachment({ filename: 'active.jpg' }))
    const deleted = await repo.insert(db, makeAttachment({ filename: 'deleted.jpg' }))
    await repo.softDelete(db, deleted.id, OPERATOR_2)

    const activeOnly = await repo.listBySocio(db, SOCIO_A)
    expect(activeOnly).toHaveLength(1)
    expect(activeOnly[0]!.id).toBe(active.id)

    const all = await repo.listBySocio(db, SOCIO_A, { includeDeleted: true })
    expect(all).toHaveLength(2)
    const allIds = all.map((r) => r.id).sort()
    expect(allIds).toEqual([active.id, deleted.id].sort())
  })
})

describe('attachments-repository — softDelete', () => {
  it('sets deleted_at + deleted_by and returns true', async () => {
    const row = await repo.insert(db, makeAttachment({ filename: 'x.jpg' }))
    const ok = await repo.softDelete(db, row.id, OPERATOR_2)
    expect(ok).toBe(true)
    const found = await repo.findById(db, row.id)
    expect(found?.deletedAt).toBeInstanceOf(Date)
    expect(found?.deletedBy).toBe(OPERATOR_2)
  })

  it('returns false when the row is already soft-deleted', async () => {
    const row = await repo.insert(db, makeAttachment({ filename: 'x.jpg' }))
    await repo.softDelete(db, row.id, OPERATOR_2)
    const second = await repo.softDelete(db, row.id, OPERATOR_2)
    expect(second).toBe(false)
  })

  it('returns false when the row does not exist', async () => {
    const ok = await repo.softDelete(db, '00000000-0000-4000-8000-000000000099', OPERATOR_2)
    expect(ok).toBe(false)
  })

  it('after soft delete, the row disappears from listBySocio (default opts)', async () => {
    await repo.insert(db, makeAttachment({ filename: 'a.jpg' }))
    const b = await repo.insert(db, makeAttachment({ filename: 'b.jpg' }))
    await repo.softDelete(db, b.id, OPERATOR_2)
    const items = await repo.listBySocio(db, SOCIO_A)
    expect(items.map((i) => i.filename)).toEqual(['a.jpg'])
  })
})
