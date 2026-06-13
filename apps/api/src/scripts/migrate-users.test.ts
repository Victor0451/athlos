import { describe, it, expect } from 'vitest'
import { mapUsuarioRow, migrateUsuario, type MigrateResult } from './migrate-users.ts'
import type { DataTable } from 'dbf-reader/models/dbf-file'
import { createStandinDb } from '../test-standins/db.ts'
import type { Db } from '@athlos/db'

/**
 * Tests for the legacy USUARIO.DBF migration script.
 *
 * Uses the in-memory Drizzle standin (no real DB needed). Bcrypt
 * hashing is replaced with a stub that returns a deterministic hash
 * so the test runs in milliseconds.
 */

function makeTable(rows: Array<Record<string, unknown>>): DataTable {
  return {
    columns: rows[0] ? Object.keys(rows[0]).map((name) => ({ name, type: 'C' })) : [],
    rows,
  }
}

function hashFn(plain: string): Promise<string> {
  // Deterministic, non-bcrypt placeholder — avoids the 250ms cost-12
  // bcrypt roundtrip the production script uses.
  return Promise.resolve(`hashed:${plain}`)
}

describe('mapUsuarioRow', () => {
  it('normalises the VFP USUARIO.DBF row to operators shape', () => {
    const result = mapUsuarioRow({
      USUCLAVE: 'vlongo',
      USUCONTR: 'plain-pwd',
      USUTIPO: 'A',
      USUREIMPRE: 'T',
      USUANULACI: true,
    })
    expect(result).toEqual({
      username: 'vlongo',
      password: 'plain-pwd',
      role: 'A',
      canReprint: true,
      canAnulate: true,
    })
  })

  it('tolerates lowercase + trimmed column names', () => {
    const result = mapUsuarioRow({
      usuclave: '  vlongo  ',
      usucontr: 'plain-pwd',
      usutipo: ' t ',
      usureimpre: '1',
      usuanulaci: '0',
    })
    expect(result.username).toBe('vlongo')
    expect(result.role).toBe('T')
    expect(result.canReprint).toBe(true)
    expect(result.canAnulate).toBe(false)
  })

  it('accepts Spanish role labels (VFP UI artefact)', () => {
    const result = mapUsuarioRow({
      USUCLAVE: 'x',
      USUCONTR: 'y',
      USUTIPO: 'TESORERO',
      USUREIMPRE: 'T',
      USUANULACI: 'F',
    })
    expect(result.role).toBe('T')
  })

  it('throws on missing USUCLAVE', () => {
    expect(() => mapUsuarioRow({ USUCONTR: 'pwd', USUTIPO: 'A' })).toThrow(/missing USUCLAVE/)
  })

  it('throws on missing USUCONTR', () => {
    expect(() => mapUsuarioRow({ USUCLAVE: 'vlongo', USUTIPO: 'A' })).toThrow(/missing USUCONTR/)
  })

  it('throws on unknown USUTIPO', () => {
    expect(() => mapUsuarioRow({ USUCLAVE: 'vlongo', USUCONTR: 'pwd', USUTIPO: 'X' })).toThrow(
      /unknown USUTIPO/,
    )
  })
})

describe('migrateUsuario', () => {
  it('inserts every row and reports the count', async () => {
    const standin = createStandinDb()
    const table = makeTable([
      { USUCLAVE: 'a', USUCONTR: 'p1', USUTIPO: 'A', USUREIMPRE: 'T', USUANULACI: 'T' },
      { USUCLAVE: 'b', USUCONTR: 'p2', USUTIPO: 'T', USUREIMPRE: 'F', USUANULACI: 'T' },
    ])
    const result: MigrateResult = await migrateUsuario(standin.drizzle as unknown as Db, table, {
      hashFn,
    })
    expect(result.read).toBe(2)
    expect(result.inserted).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
    expect(standin.state.operators).toHaveLength(2)
    expect(standin.state.operators[0]?.username).toBe('a')
    expect(standin.state.operators[0]?.role).toBe('A')
    expect(standin.state.operators[0]?.passwordHash).toBe('hashed:p1')
  })

  it('skips duplicate usernames (idempotent re-run)', async () => {
    const standin = createStandinDb()
    const table = makeTable([
      { USUCLAVE: 'a', USUCONTR: 'p1', USUTIPO: 'A', USUREIMPRE: 'T', USUANULACI: 'T' },
    ])
    const first = await migrateUsuario(standin.drizzle as unknown as Db, table, { hashFn })
    const second = await migrateUsuario(standin.drizzle as unknown as Db, table, { hashFn })
    expect(first.inserted).toBe(1)
    expect(first.skipped).toBe(0)
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBe(1)
    expect(standin.state.operators).toHaveLength(1)
  })

  it('captures row errors and continues', async () => {
    const standin = createStandinDb()
    const table = makeTable([
      { USUCLAVE: 'a', USUCONTR: 'p1', USUTIPO: 'A', USUREIMPRE: 'T', USUANULACI: 'T' },
      { USUCLAVE: '', USUCONTR: 'p2', USUTIPO: 'A' } as Record<string, unknown>, // missing USUCLAVE
      { USUCLAVE: 'b', USUCONTR: 'p3', USUTIPO: 'T', USUREIMPRE: 'F', USUANULACI: 'F' },
    ])
    const result = await migrateUsuario(standin.drizzle as unknown as Db, table, { hashFn })
    expect(result.read).toBe(3)
    expect(result.inserted).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toMatch(/missing USUCLAVE/)
    expect(standin.state.operators).toHaveLength(2)
  })

  it('handles an empty DBF', async () => {
    const standin = createStandinDb()
    const result = await migrateUsuario(standin.drizzle as unknown as Db, makeTable([]), { hashFn })
    expect(result.read).toBe(0)
    expect(result.inserted).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('coerces truthy canReprint / canAnulate', async () => {
    const standin = createStandinDb()
    const table = makeTable([
      { USUCLAVE: 'a', USUCONTR: 'p', USUTIPO: 'O', USUREIMPRE: 'SI', USUANULACI: 'false' },
      { USUCLAVE: 'b', USUCONTR: 'p', USUTIPO: 'O', USUREIMPRE: '0', USUANULACI: 'N' },
    ])
    await migrateUsuario(standin.drizzle as unknown as Db, table, { hashFn })
    expect(standin.state.operators[0]?.canReprint).toBe(true)
    expect(standin.state.operators[0]?.canAnulate).toBe(false)
    expect(standin.state.operators[1]?.canReprint).toBe(false)
    expect(standin.state.operators[1]?.canAnulate).toBe(false)
  })
})
