import { describe, it, expect, beforeEach } from 'vitest'
import { createStandinDb } from '../../test-standins/db.ts'
import * as svc from './service.ts'
import type { Db } from '@athlos/db'

/**
 * Service-level tests for the socios module. Pins the contract:
 *  - getById throws NOT_FOUND for unknown ids
 *  - create / update / softDelete emit audit_events rows
 *  - softDelete preserves the row (estado='baja', deletedAt set)
 */

function newSocioInput(over: Record<string, unknown> = {}) {
  return {
    numeroSocio: '0001',
    nombre: 'Juan',
    apellido: 'Pérez',
    dni: '12345678',
    fechaAlta: '2024-01-15',
    ...over,
  }
}

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

describe('socios service — getById', () => {
  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(svc.getById(db, '00000000-0000-4000-8000-000000000099')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('socios service — create', () => {
  it('returns the row and emits a SOCIO_CREATED audit event', async () => {
    const row = await svc.create(db, newSocioInput({ numeroSocio: '0001', dni: '12345678' }), {
      operatorId: 'op-1',
    })
    expect(row.numeroSocio).toBe('0001')
    const audits = standin.state.auditEvents ?? []
    expect(audits.find((a) => a.entityId === row.id && a.action === 'SOCIO_CREATED')).toBeDefined()
  })
})

describe('socios service — update', () => {
  it('emits SOCIO_UPDATED with old and new snapshots', async () => {
    const created = await svc.create(db, newSocioInput({ numeroSocio: '0100', dni: '20111111' }))
    const updated = await svc.update(
      db,
      created.id,
      { telefono: '+5491100000000' },
      { operatorId: 'op-1' },
    )
    expect(updated.telefono).toBe('+5491100000000')
    const audits = standin.state.auditEvents ?? []
    const row = audits.find((a) => a.entityId === created.id && a.action === 'SOCIO_UPDATED')
    expect(row).toBeDefined()
  })

  it('throws NOT_FOUND when the id is unknown', async () => {
    await expect(
      svc.update(db, '00000000-0000-4000-8000-000000000099', { telefono: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('socios service — softDelete', () => {
  it('sets estado=baja and emits SOCIO_DELETED', async () => {
    const created = await svc.create(db, newSocioInput({ numeroSocio: '0200', dni: '30111111' }))
    const deleted = await svc.softDelete(db, created.id, { operatorId: 'op-1' })
    expect(deleted.estado).toBe('baja')
    expect(deleted.deletedAt).toBeInstanceOf(Date)
    const audits = standin.state.auditEvents ?? []
    expect(
      audits.find((a) => a.entityId === created.id && a.action === 'SOCIO_DELETED'),
    ).toBeDefined()
  })
})
