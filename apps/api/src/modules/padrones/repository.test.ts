import { describe, it, expect, beforeEach } from 'vitest'
import { createStandinDb } from '../../test-standins/db.ts'
import * as repo from './repository.ts'
import type { Db } from '@athlos/db'

/**
 * Repository-level tests for the padrones module. Pins the
 * "filter by disciplina + ejercicio returns only that
 * disciplina's socios" AC.
 */

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

async function seed() {
  standin.state.disciplinas.push({
    id: 'd-futbol',
    codigo: 'FUTBOL',
    nombre: 'Fútbol',
    createdAt: new Date(),
  } as never)
  standin.state.disciplinas.push({
    id: 'd-hockey',
    codigo: 'HOCKEY',
    nombre: 'Hockey',
    createdAt: new Date(),
  } as never)
  standin.state.ejercicios.push({
    id: 'e-2024',
    anio: 2024,
    descripcion: 'Ejercicio 2024',
    fechaInicio: '2024-01-01',
    fechaFin: '2024-12-31',
    createdAt: new Date(),
  } as never)
  standin.state.ejercicios.push({
    id: 'e-2025',
    anio: 2025,
    descripcion: 'Ejercicio 2025',
    fechaInicio: '2025-01-01',
    fechaFin: '2025-12-31',
    createdAt: new Date(),
  } as never)
  standin.state.socios.push({
    id: 's-1',
    numeroSocio: '0001',
    nombre: 'Juan',
    apellido: 'García',
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
  standin.state.socios.push({
    id: 's-2',
    numeroSocio: '0002',
    nombre: 'María',
    apellido: 'Pérez',
    dni: '22222222',
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
  standin.state.inscripciones.push({
    id: 'i-1',
    socioId: 's-1',
    disciplinaId: 'd-futbol',
    ejercicioId: 'e-2024',
    estado: 'activa',
    fechaAlta: '2024-03-01',
    createdAt: new Date(),
  } as never)
  standin.state.inscripciones.push({
    id: 'i-2',
    socioId: 's-2',
    disciplinaId: 'd-hockey',
    ejercicioId: 'e-2024',
    estado: 'activa',
    fechaAlta: '2024-03-01',
    createdAt: new Date(),
  } as never)
  standin.state.inscripciones.push({
    id: 'i-3',
    socioId: 's-1',
    disciplinaId: 'd-futbol',
    ejercicioId: 'e-2025',
    estado: 'activa',
    fechaAlta: '2025-03-01',
    createdAt: new Date(),
  } as never)
}

describe('padrones repository — listByDisciplina', () => {
  it('lists disciplines with their ids and operator-facing names', async () => {
    await seed()

    await expect(repo.listDisciplinas(db)).resolves.toEqual([
      { id: 'd-futbol', codigo: 'FUTBOL', nombre: 'Fútbol' },
      { id: 'd-hockey', codigo: 'HOCKEY', nombre: 'Hockey' },
    ])
  })

  it('returns only socios in the matching disciplina + ejercicio', async () => {
    await seed()
    const result = await repo.listByDisciplina(db, {
      disciplinaCodigo: 'FUTBOL',
      ejercicioAnio: 2024,
      page: 1,
      limit: 50,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      socioId: 's-1',
      disciplinaCodigo: 'FUTBOL',
      ejercicioAnio: 2024,
    })
  })

  it('switches the result when the ejercicio changes', async () => {
    await seed()
    const r2025 = await repo.listByDisciplina(db, {
      disciplinaCodigo: 'FUTBOL',
      ejercicioAnio: 2025,
      page: 1,
      limit: 50,
    })
    expect(r2025.items).toHaveLength(1)
    expect(r2025.items[0]?.socioId).toBe('s-1')
  })

  it('returns empty for an ejercicio with no inscriptions', async () => {
    await seed()
    standin.state.inscripciones.length = 0
    const r = await repo.listByDisciplina(db, {
      disciplinaCodigo: 'FUTBOL',
      ejercicioAnio: 2024,
      page: 1,
      limit: 50,
    })
    expect(r.items).toHaveLength(0)
  })

  it('throws NOT_FOUND for an unknown disciplina', async () => {
    await seed()
    await expect(
      repo.listByDisciplina(db, {
        disciplinaCodigo: 'NADAR',
        ejercicioAnio: 2024,
        page: 1,
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NOT_FOUND for an unknown ejercicio', async () => {
    await seed()
    await expect(
      repo.listByDisciplina(db, {
        disciplinaCodigo: 'FUTBOL',
        ejercicioAnio: 2099,
        page: 1,
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
