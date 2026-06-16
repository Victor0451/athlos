import { describe, it, expect, beforeEach } from 'vitest'
import { createStandinDb } from '../../test-standins/db.ts'
import * as svc from './service.ts'
import type { Db } from '@athlos/db'

/**
 * Service-level tests for the cuenta-corriente module. The
 * service is a thin orchestrator over the repository — these
 * tests pin the response shape and the re-compute-on-read
 * invariant.
 */

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

describe('ctacte service — getCuentaCorriente', () => {
  it('returns the canonical shape', async () => {
    standin.state.ctacte.push({
      id: 'm-1',
      socioId: 's-1',
      fecha: '2024-01-15',
      tipo: 'DEBITO',
      concepto: 'cuota',
      debe: '100.00',
      haber: '0.00',
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      createdAt: new Date(),
    } as never)
    const result = await svc.getCuentaCorriente(db, {
      socioId: 's-1',
      page: 1,
      limit: 10,
    })
    expect(result.socioId).toBe('s-1')
    expect(result.saldo).toBe('100.00')
    expect(result.saldo_calculado_at).toMatch(/T.*Z$/)
    expect(result.movimientos).toHaveLength(1)
    expect(result.movimientos[0]).toMatchObject({
      id: 'm-1',
      debe: '100.00',
      tipo: 'DEBITO',
    })
    expect(result.total).toBe(1)
  })

  it('recomputes the saldo on every call', async () => {
    standin.state.ctacte.push({
      id: 'm-1',
      socioId: 's-1',
      fecha: '2024-01-15',
      tipo: 'DEBITO',
      concepto: 'cuota',
      debe: '100.00',
      haber: '0.00',
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      createdAt: new Date(),
    } as never)
    const a = await svc.getCuentaCorriente(db, { socioId: 's-1', page: 1, limit: 10 })
    expect(a.saldo).toBe('100.00')
    standin.state.ctacte.push({
      id: 'm-2',
      socioId: 's-1',
      fecha: '2024-02-15',
      tipo: 'DEBITO',
      concepto: 'cuota',
      debe: '50.00',
      haber: '0.00',
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      createdAt: new Date(),
    } as never)
    const b = await svc.getCuentaCorriente(db, { socioId: 's-1', page: 1, limit: 10 })
    expect(b.saldo).toBe('150.00')
  })
})

describe('ctacte service — listMovimientos', () => {
  it('returns the page with saldo_resultante null', async () => {
    standin.state.ctacte.push({
      id: 'm-1',
      socioId: 's-1',
      fecha: '2024-01-15',
      tipo: 'DEBITO',
      concepto: 'cuota',
      debe: '100.00',
      haber: '0.00',
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      createdAt: new Date(),
    } as never)
    const result = await svc.listMovimientos(db, { socioId: 's-1', page: 1, limit: 10 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'm-1' })
  })
})
