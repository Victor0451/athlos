import { describe, it, expect, beforeEach } from 'vitest'
import { createStandinDb } from '../../test-standins/db.ts'
import * as repo from './repository.ts'
import type { Db } from '@athlos/db'
import type { Ctacte } from '@athlos/db/schema'

/**
 * Repository-level tests for the cuenta-corriente module. Uses
 * the in-memory standin so the suite runs in-process.
 *
 * The saldo math: `sum(debe - haber)` excluding anuladas. The
 * `parseCents` / `centsToString` helpers shipped with the standin
 * are the same bigint math the real driver would run in SQL, so
 * the assertions are byte-equal to the production path.
 */

function mov(over: Partial<Ctacte>): Ctacte {
  return {
    id: crypto.randomUUID(),
    socioId: 's-1',
    fecha: '2024-01-15',
    tipo: 'DEBITO',
    concepto: 'cuota',
    debe: '0.00',
    haber: '0.00',
    anulado: false,
    anuladoAt: null,
    anuladoMotivo: null,
    createdAt: new Date('2024-01-15T12:00:00Z'),
    ...over,
  } as Ctacte
}

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

describe('ctacte repository — getSaldo', () => {
  it('returns 0.00 for a socio with no movements', async () => {
    const saldo = await repo.getSaldo(db, 's-1')
    expect(saldo).toBe('0.00')
  })

  it('sums debe - haber for a socio', async () => {
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '100.00', haber: '0.00' }))
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '50.00', haber: '0.00' }))
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '0.00', haber: '30.00' }))
    const saldo = await repo.getSaldo(db, 's-1')
    expect(saldo).toBe('120.00')
  })

  it('excludes anuladas by default', async () => {
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '100.00' }))
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '200.00', anulado: true }))
    const saldo = await repo.getSaldo(db, 's-1')
    expect(saldo).toBe('100.00')
  })

  it('includes anuladas when incluirAnuladas is true', async () => {
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '100.00' }))
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '200.00', anulado: true }))
    const saldo = await repo.getSaldo(db, 's-1', { incluirAnuladas: true })
    expect(saldo).toBe('300.00')
  })

  it('isolates saldos per socio', async () => {
    standin.state.ctacte.push(mov({ socioId: 's-1', debe: '100.00' }))
    standin.state.ctacte.push(mov({ socioId: 's-2', debe: '500.00' }))
    expect(await repo.getSaldo(db, 's-1')).toBe('100.00')
    expect(await repo.getSaldo(db, 's-2')).toBe('500.00')
  })
})

describe('ctacte repository — getMovimientos', () => {
  it('returns the page of movements for a socio', async () => {
    for (let i = 0; i < 5; i += 1) {
      standin.state.ctacte.push(mov({ socioId: 's-1', debe: '10.00', fecha: `2024-01-1${i + 1}` }))
    }
    const result = await repo.getMovimientos(db, {
      socioId: 's-1',
      page: 1,
      limit: 3,
    })
    expect(result.items).toHaveLength(3)
    expect(result.total).toBe(5)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(3)
  })

  it('orders by fecha desc, id desc', async () => {
    standin.state.ctacte.push(
      mov({ socioId: 's-1', debe: '10.00', fecha: '2024-01-10', id: 'm-old' }),
    )
    standin.state.ctacte.push(
      mov({ socioId: 's-1', debe: '10.00', fecha: '2024-01-20', id: 'm-new' }),
    )
    const result = await repo.getMovimientos(db, {
      socioId: 's-1',
      page: 1,
      limit: 10,
    })
    expect(result.items[0]?.id).toBe('m-new')
    expect(result.items[1]?.id).toBe('m-old')
  })
})
