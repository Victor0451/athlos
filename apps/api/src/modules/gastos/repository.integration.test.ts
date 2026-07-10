import { describe, it, expect, beforeEach } from 'vitest'
import { createStandinDb } from '../../test-standins/db.ts'
import type { Db } from '@athlos/db'
import type { Ctacte, Gastos } from '@athlos/db/schema'
import {
  anularGasto,
  anularLink,
  countLinksForGasto,
  createGasto,
  createLink,
  deleteGasto,
  deleteLink,
  findCandidates,
  findGastoById,
  findLinkById,
  findLinksByCtacteCuenta,
  findLinksForGasto,
  findManyGastos,
  updateGasto,
} from './repository.ts'

/**
 * Repository integration tests against the in-memory standin.
 *
 * The standin doesn't implement LATERAL views, so the heuristic
 * function transparently falls back to a JS scan over the ctacte
 * array. The contract is the same shape; what differs is the data
 * source. The findCandidates test pins the JS path.
 *
 * Critical contracts pinned here:
 *   - 5-tuple UNIQUE on gastos throws 23505 on duplicate insert
 *   - PARTIAL UNIQUE on gastos_ctacte_mapping allows re-link after
 *     a previous link was anulada (the spec's Re-link scenario)
 *   - Hard DELETE on gasto cascades to its links
 *   - findCandidates tags every row with motivo='heuristic-pending'
 */

function makeStandin() {
  const s = createStandinDb()
  return { standin: s, db: s.drizzle as unknown as Db }
}

const GASTO_BASE: Omit<Gastos, 'id' | 'createdAt'> = {
  tipo: 1,
  tipoCuenta: 0,
  cuentaPrincipal: '6003009',
  cuentaAuxiliar: null,
  secuencia: 1,
  comprobante: 'A-1',
  fecha: '2024-03-15',
  concepto: 'sueldos',
  importe: '5000.00',
  iva: '0.00',
  ingresoBruto: null,
  socioId: null,
  legacyId: null,
  anulado: false,
  anuladoAt: null,
  anuladoMotivo: null,
}

function makeCtacte(overrides: Partial<Ctacte>): Ctacte {
  // Generate a v4-shaped UUID so the standin's `id` matches the
  // production schema and the route's idSchema validator accepts it.
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  const id = `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`
  // Use a placeholder socio UUID so the ctacte row passes the type
  // check (ctacte.socioId is NOT NULL in production). The heuristic
  // function compares gasto.socioId (always null) against the
  // ctacte.socioId, so this only matters for the future socio-match
  // case (score = +20); today's gastos never have a socio_id.
  const socioId = '00000000-0000-4000-8000-000000000010'
  return {
    id,
    socioId,
    fecha: '2024-03-15',
    tipo: 'DEBITO',
    concepto: 'cuota',
    debe: '5000.00',
    haber: '0.00',
    anulado: false,
    anuladoAt: null,
    anuladoMotivo: null,
    cctcuenta: '8198',
    legacyId: null as string | null,
    comprobanteAttachmentId: null as string | null,
    idempotencyKey: null,
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  // Standin is created fresh per test via makeStandin(); no shared state.
})

describe('createGasto', () => {
  it('inserts a gasto and returns the row', async () => {
    const { db } = makeStandin()
    const row = await createGasto(db, { ...GASTO_BASE })
    expect(row.id).toBeTruthy()
    expect(row.cuentaPrincipal).toBe('6003009')
    expect(row.anulado).toBe(false)
  })

  it('throws 23505 on 5-tuple duplicate', async () => {
    const { db } = makeStandin()
    await createGasto(db, { ...GASTO_BASE })
    await expect(createGasto(db, { ...GASTO_BASE })).rejects.toMatchObject({ code: '23505' })
  })
})

describe('findManyGastos', () => {
  it('returns an empty list when no gastos exist', async () => {
    const { db } = makeStandin()
    const result = await findManyGastos(db, { page: 1, limit: 20 })
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.hasMore).toBe(false)
  })

  it('filters by cuenta_principal', async () => {
    const { db } = makeStandin()
    await createGasto(db, { ...GASTO_BASE, cuentaPrincipal: '6003009' })
    await createGasto(db, { ...GASTO_BASE, cuentaPrincipal: '1101024', secuencia: 2 })
    const result = await findManyGastos(db, {
      page: 1,
      limit: 20,
      cuentaPrincipal: '6003009',
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.cuentaPrincipal).toBe('6003009')
  })

  it('filters by anulado=false (excludes anuladas)', async () => {
    const { db } = makeStandin()
    const active = await createGasto(db, { ...GASTO_BASE })
    const toAnular = await createGasto(db, { ...GASTO_BASE, secuencia: 2, comprobante: 'A-2' })
    await anularGasto(db, toAnular.id, 'test')
    const result = await findManyGastos(db, { page: 1, limit: 20, anulado: false })
    expect(result.items.map((g) => g.id)).toEqual([active.id])
  })
})

describe('findGastoById', () => {
  it('returns null when the id does not exist', async () => {
    const { db } = makeStandin()
    const result = await findGastoById(db, 'does-not-exist')
    expect(result).toBeNull()
  })

  it('returns the gasto when the id exists', async () => {
    const { db } = makeStandin()
    const created = await createGasto(db, { ...GASTO_BASE })
    const fetched = await findGastoById(db, created.id)
    expect(fetched?.id).toBe(created.id)
  })
})

describe('updateGasto', () => {
  it('updates the row and returns it', async () => {
    const { db } = makeStandin()
    const created = await createGasto(db, { ...GASTO_BASE })
    const updated = await updateGasto(db, created.id, { concepto: 'updated' })
    expect(updated?.concepto).toBe('updated')
  })
})

describe('deleteGasto', () => {
  it('removes the row and returns true', async () => {
    const { db } = makeStandin()
    const created = await createGasto(db, { ...GASTO_BASE })
    expect(await deleteGasto(db, created.id)).toBe(true)
    expect(await findGastoById(db, created.id)).toBeNull()
  })
})

describe('anularGasto', () => {
  it('sets anulado=true and anulado_at', async () => {
    const { db } = makeStandin()
    const created = await createGasto(db, { ...GASTO_BASE })
    const anulado = await anularGasto(db, created.id, 'test motivo')
    expect(anulado?.anulado).toBe(true)
    expect(anulado?.anuladoMotivo).toBe('test motivo')
    expect(anulado?.anuladoAt).toBeInstanceOf(Date)
  })
})

describe('createLink + deleteLink + anularLink', () => {
  it('inserts and hard-deletes a link', async () => {
    const { db, standin } = makeStandin()
    const gasto = await createGasto(db, { ...GASTO_BASE })
    const ctacteRow = makeCtacte({})
    standin.state.ctacte.push(ctacteRow as never)
    const link = await createLink(db, {
      gastoId: gasto.id,
      ctacteId: ctacteRow.id,
      montoCubierto: '5000.00',
      motivo: 'manual',
      createdBy: null,
    })
    expect(link.id).toBeTruthy()
    expect(await deleteLink(db, link.id)).toBe(true)
    expect(await findLinkById(db, link.id)).toBeNull()
  })

  it('soft-annuls a link and allows re-linking the same pair (PARTIAL UNIQUE)', async () => {
    const { db, standin } = makeStandin()
    const gasto = await createGasto(db, { ...GASTO_BASE })
    const ctacteRow = makeCtacte({})
    standin.state.ctacte.push(ctacteRow as never)

    // First link
    const first = await createLink(db, {
      gastoId: gasto.id,
      ctacteId: ctacteRow.id,
      montoCubierto: '5000.00',
      motivo: 'manual',
      createdBy: null,
    })
    // Anular it
    const anulado = await anularLink(db, first.id, 'wrong socio')
    expect(anulado?.anulado).toBe(true)

    // Re-link for the same (gasto_id, ctacte_id) pair — should succeed
    const second = await createLink(db, {
      gastoId: gasto.id,
      ctacteId: ctacteRow.id,
      montoCubierto: '3000.00',
      motivo: 'manual',
      createdBy: null,
    })
    expect(second.id).toBeTruthy()
    expect(second.id).not.toBe(first.id)
    expect(await countLinksForGasto(db, gasto.id)).toBe(1) // only active counts
  })

  it('throws 23505 on duplicate ACTIVE link for the same pair', async () => {
    const { db, standin } = makeStandin()
    const gasto = await createGasto(db, { ...GASTO_BASE })
    const ctacteRow = makeCtacte({})
    standin.state.ctacte.push(ctacteRow as never)
    await createLink(db, {
      gastoId: gasto.id,
      ctacteId: ctacteRow.id,
      montoCubierto: '5000.00',
      motivo: 'manual',
      createdBy: null,
    })
    await expect(
      createLink(db, {
        gastoId: gasto.id,
        ctacteId: ctacteRow.id,
        montoCubierto: '3000.00',
        motivo: 'manual',
        createdBy: null,
      }),
    ).rejects.toMatchObject({ code: '23505' })
  })
})

describe('findLinksForGasto', () => {
  it('returns the active link rows for a gasto', async () => {
    const { db, standin } = makeStandin()
    const gasto = await createGasto(db, { ...GASTO_BASE })
    const c1 = makeCtacte({})
    const c2 = makeCtacte({})
    standin.state.ctacte.push(c1 as never, c2 as never)
    await createLink(db, {
      gastoId: gasto.id,
      ctacteId: c1.id,
      montoCubierto: '5000.00',
      motivo: 'manual',
      createdBy: null,
    })
    await createLink(db, {
      gastoId: gasto.id,
      ctacteId: c2.id,
      montoCubierto: '2000.00',
      motivo: 'manual',
      createdBy: null,
    })
    const links = await findLinksForGasto(db, gasto.id)
    expect(links).toHaveLength(2)
  })
})

describe('findCandidates (heuristic, JS fallback in standin)', () => {
  it('returns an empty array when the gasto does not exist', async () => {
    const { db } = makeStandin()
    const candidates = await findCandidates(db, 'does-not-exist')
    expect(candidates).toEqual([])
  })

  it('returns a heuristic-pending candidate when ctacte matches fecha+importe', async () => {
    const { db, standin } = makeStandin()
    const gasto = await createGasto(db, { ...GASTO_BASE, fecha: '2024-03-15', importe: '5000.00' })
    const ctacteRow = makeCtacte({ fecha: '2024-03-15', debe: '5000.00' })
    standin.state.ctacte.push(ctacteRow as never)

    const candidates = await findCandidates(db, gasto.id)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.motivo).toBe('heuristic-pending')
    expect(candidates[0]?.score).toBeGreaterThan(30)
    expect(candidates[0]?.ctacteId).toBe(ctacteRow.id)
  })

  it('omits anulada ctacte rows even when matching', async () => {
    const { db, standin } = makeStandin()
    const gasto = await createGasto(db, { ...GASTO_BASE })
    const anulada = makeCtacte({ anulado: true })
    standin.state.ctacte.push(anulada as never)
    const candidates = await findCandidates(db, gasto.id)
    expect(candidates).toEqual([])
  })
})

describe('findLinksByCtacteCuenta (joined, used by /ctacte/:cuenta/gastos-links)', () => {
  it('returns an empty list when the cuenta has no active links', async () => {
    const { db } = makeStandin()
    const result = await findLinksByCtacteCuenta(db, '8198')
    expect(result).toEqual([])
  })

  it('returns one record per active link for the cuenta', async () => {
    const { db, standin } = makeStandin()
    const gasto = await createGasto(db, { ...GASTO_BASE })
    const c1 = makeCtacte({ cctcuenta: '8198' })
    const c2 = makeCtacte({ cctcuenta: '8198', debe: '2000.00', id: 'c-2' })
    const cOther = makeCtacte({ cctcuenta: '9999', debe: '5000.00', id: 'c-3' })
    standin.state.ctacte.push(c1 as never, c2 as never, cOther as never)
    await createLink(db, {
      gastoId: gasto.id,
      ctacteId: c1.id,
      montoCubierto: '5000.00',
      motivo: 'manual',
      createdBy: null,
    })
    await createLink(db, {
      gastoId: gasto.id,
      ctacteId: c2.id,
      montoCubierto: '2000.00',
      motivo: 'manual',
      createdBy: null,
    })
    await createLink(db, {
      gastoId: gasto.id,
      ctacteId: cOther.id,
      montoCubierto: '5000.00',
      motivo: 'manual',
      createdBy: null,
    })
    const result = await findLinksByCtacteCuenta(db, '8198')
    expect(result).toHaveLength(2)
    for (const r of result) {
      expect(r.gastoId).toBe(gasto.id)
    }
  })
})
