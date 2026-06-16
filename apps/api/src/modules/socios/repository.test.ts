import { describe, it, expect, beforeEach } from 'vitest'
import { createStandinDb } from '../../test-standins/db.ts'
import * as repo from './repository.ts'
import type { Db } from '@athlos/db'

/**
 * Repository-level tests for the socios module. We use the
 * in-memory standin so the suite runs in-process — every query
 * shape is exercised against the standin to make sure the helper
 * funnels through the standin correctly.
 */

function newSocio(over: Record<string, unknown> = {}) {
  return {
    numeroSocio: '0001',
    nombre: 'Juan',
    apellido: 'Pérez',
    dni: '12345678',
    fechaAlta: '2024-01-15',
    estado: 'activo' as const,
    categoria: 'TITULAR',
    direccion: 'Calle 123',
    telefono: '+541111111111',
    email: 'juan@example.com',
    ...over,
  }
}

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

describe('socios repository — findById', () => {
  it('returns null for an unknown id', async () => {
    const row = await repo.findById(db, '00000000-0000-4000-8000-000000000099')
    expect(row).toBeNull()
  })

  it('returns the row when present', async () => {
    const inserted = await repo.insert(db, newSocio({ numeroSocio: '0002', dni: '22222222' }))
    const row = await repo.findById(db, inserted.id)
    expect(row).toMatchObject({ id: inserted.id, numeroSocio: '0002' })
  })
})

describe('socios repository — list', () => {
  it('pages and counts results', async () => {
    for (let i = 0; i < 25; i += 1) {
      await repo.insert(
        db,
        newSocio({
          numeroSocio: String(i + 1).padStart(4, '0'),
          dni: String(20_000_000 + i),
        }),
      )
    }
    const page1 = await repo.list(db, { page: 1, limit: 10 })
    expect(page1.items).toHaveLength(10)
    expect(page1.total).toBe(25)
    expect(page1.page).toBe(1)
    expect(page1.limit).toBe(10)

    const page3 = await repo.list(db, { page: 3, limit: 10 })
    expect(page3.items).toHaveLength(5)
  })

  it('filters by estado', async () => {
    await repo.insert(db, newSocio({ numeroSocio: '0100', dni: '30111111' }))
    await repo.insert(
      db,
      newSocio({ numeroSocio: '0101', dni: '30222222', estado: 'suspendido' as const }),
    )
    const result = await repo.list(db, { page: 1, limit: 20, filters: { estado: 'activo' } })
    expect(result.items.every((s) => s.estado === 'activo')).toBe(true)
  })

  it('hides soft-deleted rows in the default list', async () => {
    const a = await repo.insert(db, newSocio({ numeroSocio: '0200', dni: '40111111' }))
    await repo.softDelete(db, a.id)
    const result = await repo.list(db, { page: 1, limit: 20 })
    expect(result.items.find((s) => s.id === a.id)).toBeUndefined()
  })

  it('returns the soft-deleted row when filtered by estado=baja', async () => {
    const a = await repo.insert(db, newSocio({ numeroSocio: '0200', dni: '40111111' }))
    await repo.softDelete(db, a.id)
    const result = await repo.list(db, {
      page: 1,
      limit: 20,
      filters: { estado: 'baja' },
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(a.id)
  })

  it('searches by apellido / nombre / dni case-insensitively', async () => {
    await repo.insert(db, newSocio({ numeroSocio: '0300', dni: '50111111', apellido: 'García' }))
    await repo.insert(db, newSocio({ numeroSocio: '0301', dni: '50222222', nombre: 'María' }))
    await repo.insert(db, newSocio({ numeroSocio: '0302', dni: '50999999', apellido: 'López' }))
    const byApellido = await repo.list(db, {
      page: 1,
      limit: 20,
      filters: { search: 'garc' },
    })
    expect(byApellido.items.map((s) => s.apellido)).toContain('García')

    const byDni = await repo.list(db, {
      page: 1,
      limit: 20,
      filters: { search: '50222222' },
    })
    expect(byDni.items).toHaveLength(1)
    expect(byDni.items[0]?.nombre).toBe('María')
  })
})

describe('socios repository — insert', () => {
  it('returns the inserted row with an id and timestamps', async () => {
    const row = await repo.insert(db, newSocio({ numeroSocio: '0400', dni: '60111111' }))
    expect(row.id).toMatch(/^[0-9a-f-]+$/)
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.estado).toBe('activo')
  })

  it('throws CONFLICT on duplicate numero_socio', async () => {
    await repo.insert(db, newSocio({ numeroSocio: '0410', dni: '70111111' }))
    await expect(
      repo.insert(db, newSocio({ numeroSocio: '0410', dni: '70222222' })),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('socios repository — update', () => {
  it('updates the patched fields', async () => {
    const row = await repo.insert(db, newSocio({ numeroSocio: '0500', dni: '80111111' }))
    const updated = await repo.update(db, row.id, { telefono: '+5491100000000' })
    expect(updated.telefono).toBe('+5491100000000')
  })

  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(
      repo.update(db, '00000000-0000-4000-8000-000000000099', { telefono: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('socios repository — softDelete', () => {
  it('marks the row as baja without removing it', async () => {
    const row = await repo.insert(db, newSocio({ numeroSocio: '0600', dni: '90111111' }))
    const deleted = await repo.softDelete(db, row.id)
    expect(deleted.estado).toBe('baja')
    expect(deleted.deletedAt).toBeInstanceOf(Date)
    // Row is still in the table:
    const stillThere = standin.state.socios.find((s) => s.id === row.id)
    expect(stillThere).toBeDefined()
  })

  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(repo.softDelete(db, '00000000-0000-4000-8000-000000000099')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    )
  })
})
