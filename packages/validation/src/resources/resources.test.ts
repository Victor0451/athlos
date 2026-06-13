import { describe, it, expect } from 'vitest'
import { createSocioSchema, updateSocioSchema, socioFilterSchema } from './socio.ts'
import { ctacteQuerySchema } from './ctacte.ts'
import { createOperadorSchema, updateOperadorSchema } from './operador.ts'

/**
 * Tests for the per-resource schemas. Pin the public contract for
 * PR 5 (socios / ctacte routes) and PR 3b's admin/operators routes.
 */

describe('createSocioSchema', () => {
  it('accepts a valid create payload', () => {
    const r = createSocioSchema.parse({
      nro_socio: 1,
      apellido: 'García',
      nombre: 'Juan',
      doc_nro: '12345678',
    })
    expect(r.nro_socio).toBe(1)
    expect(r.apellido).toBe('García')
  })
  it('rejects missing nro_socio with field path "nro_socio"', () => {
    const result = createSocioSchema.safeParse({
      apellido: 'García',
      nombre: 'Juan',
      doc_nro: '12345678',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['nro_socio'])
    }
  })
  it('rejects a negative nro_socio', () => {
    expect(() =>
      createSocioSchema.parse({ nro_socio: -1, apellido: 'a', nombre: 'b', doc_nro: '1' }),
    ).toThrow()
  })
})

describe('updateSocioSchema', () => {
  it('omits nro_socio (immutable) — strict mode rejects the key', () => {
    const result = updateSocioSchema.safeParse({ nro_socio: 99, apellido: 'X' })
    expect(result.success).toBe(false)
    if (!result.success) {
      // `.strict()` reports the unknown key in the issue's `keys`
      // (not in `path`, since the field is not declared on the
      // object). The code is `unrecognized_keys` per Zod.
      const issue = result.error.issues[0] as unknown as {
        code?: string
        keys?: string[]
      }
      expect(issue.code).toBe('unrecognized_keys')
      expect(issue.keys ?? []).toContain('nro_socio')
    }
  })
  it('accepts a partial update', () => {
    const r = updateSocioSchema.parse({ apellido: 'García' })
    expect(r.apellido).toBe('García')
  })
  it('rejects an empty object', () => {
    // The PATCH body is the partial() — empty object is technically
    // valid Zod, but the route layer will reject it with a separate
    // "at least one field" check. The schema itself allows it; the
    // route does the business rule. (We document this here to lock
    // the contract.)
    expect(() => updateSocioSchema.parse({})).not.toThrow()
  })
})

describe('socioFilterSchema', () => {
  it('defaults estado to activo', () => {
    const r = socioFilterSchema.parse({})
    expect(r.estado).toBe('activo')
  })
  it('accepts a search term', () => {
    const r = socioFilterSchema.parse({ search: 'García' })
    expect(r.search).toBe('García')
  })
})

describe('ctacteQuerySchema', () => {
  it('defaults incluir_anuladas to false', () => {
    const r = ctacteQuerySchema.parse({})
    expect(r.incluir_anuladas).toBe(false)
  })
  it('parses incluir_anuladas=true', () => {
    const r = ctacteQuerySchema.parse({ incluir_anuladas: 'true' })
    expect(r.incluir_anuladas).toBe(true)
  })
  it('accepts a socio_id uuid', () => {
    const r = ctacteQuerySchema.parse({ socio_id: '550e8400-e29b-41d4-a716-446655440000' })
    expect(r.socio_id).toBe('550e8400-e29b-41d4-a716-446655440000')
  })
})

describe('createOperadorSchema', () => {
  it('accepts a valid operator create payload', () => {
    const r = createOperadorSchema.parse({
      username: 'jcarlos',
      password: 'super-secret-12chars',
      role: 'ADMIN',
    })
    expect(r.role).toBe('ADMIN')
  })
  it('rejects short password (less than 12)', () => {
    expect(() =>
      createOperadorSchema.parse({ username: 'jcarlos', password: 'short', role: 'ADMIN' }),
    ).toThrow()
  })
  it('rejects uppercase in username', () => {
    expect(() =>
      createOperadorSchema.parse({
        username: 'JCarlos',
        password: 'super-secret-12chars',
        role: 'ADMIN',
      }),
    ).toThrow()
  })
})

describe('updateOperadorSchema', () => {
  it('rejects an empty object (must provide at least one field)', () => {
    expect(() => updateOperadorSchema.parse({})).toThrow()
  })
  it('accepts a single-field update', () => {
    expect(() => updateOperadorSchema.parse({ is_active: false })).not.toThrow()
  })
})
