import { describe, it, expect } from 'vitest'
import {
  idSchema,
  paginationSchema,
  dateRangeSchema,
  montoSchema,
  legacyIdSchema,
  dniSchema,
  cuitSchema,
  socioEstadoSchema,
  operatorRoleSchema,
} from './primitives.ts'

/**
 * Tests for the validation primitives. The intent is to lock the
 * public surface so route handlers can compose against a known shape.
 * If any test fails, a downstream route may accept malformed input.
 */

describe('idSchema', () => {
  it('accepts a v4 uuid', () => {
    const ok = '550e8400-e29b-41d4-a716-446655440000'
    expect(idSchema.parse(ok)).toBe(ok)
  })
  it('rejects a non-uuid string', () => {
    expect(() => idSchema.parse('not-a-uuid')).toThrow()
  })
})

describe('paginationSchema', () => {
  it('applies defaults when called with empty object', () => {
    const r = paginationSchema.parse({})
    expect(r.page).toBe(1)
    expect(r.limit).toBe(20)
    expect(r.order).toBe('asc')
  })
  it('coerces string numbers from query params', () => {
    const r = paginationSchema.parse({ page: '3', limit: '50' })
    expect(r.page).toBe(3)
    expect(r.limit).toBe(50)
  })
  it('rejects limit above 100', () => {
    expect(() => paginationSchema.parse({ limit: '999' })).toThrow()
  })
  it('rejects page below 1', () => {
    expect(() => paginationSchema.parse({ page: '0' })).toThrow()
  })
  it('rejects unknown order', () => {
    expect(() => paginationSchema.parse({ order: 'descending' })).toThrow()
  })
})

describe('dateRangeSchema', () => {
  it('accepts a partial range', () => {
    const r = dateRangeSchema.parse({ desde: '2026-01-01T00:00:00Z' })
    expect(r.desde).toBe('2026-01-01T00:00:00Z')
    expect(r.hasta).toBeUndefined()
  })
  it('rejects a non-iso string', () => {
    expect(() => dateRangeSchema.parse({ desde: 'yesterday' })).toThrow()
  })
})

describe('montoSchema', () => {
  it('accepts a positive two-decimal string', () => {
    expect(montoSchema.parse('1234.56')).toBe('1234.56')
  })
  it('accepts a negative two-decimal string (anulación)', () => {
    expect(montoSchema.parse('-1.50')).toBe('-1.50')
  })
  it('rejects a non-string number', () => {
    expect(() => montoSchema.parse(1.5 as unknown as string)).toThrow()
  })
  it('rejects more than two decimal places', () => {
    expect(() => montoSchema.parse('1.234')).toThrow()
  })
})

describe('legacyIdSchema', () => {
  it('accepts a clipper-style id', () => {
    expect(legacyIdSchema.parse('CTACTE.000123')).toBe('CTACTE.000123')
    expect(legacyIdSchema.parse('SOC-0042')).toBe('SOC-0042')
  })
  it('rejects lowercase letters', () => {
    expect(() => legacyIdSchema.parse('ctacte.000123')).toThrow()
  })
  it('rejects length > 32', () => {
    expect(() => legacyIdSchema.parse('A'.repeat(33))).toThrow()
  })
})

describe('dniSchema', () => {
  it('accepts 7 digits', () => {
    expect(dniSchema.parse('1234567')).toBe('1234567')
  })
  it('accepts 8 digits', () => {
    expect(dniSchema.parse('12345678')).toBe('12345678')
  })
  it('rejects 6 digits', () => {
    expect(() => dniSchema.parse('123456')).toThrow()
  })
  it('rejects formatted 12.345.678', () => {
    expect(() => dniSchema.parse('12.345.678')).toThrow()
  })
})

describe('cuitSchema', () => {
  it('accepts a valid 11-digit formatted cuit', () => {
    expect(cuitSchema.parse('20-12345678-9')).toBe('20-12345678-9')
  })
  it('rejects an unformatted 11 digits', () => {
    expect(() => cuitSchema.parse('20123456789')).toThrow()
  })
  it('rejects a wrong format', () => {
    expect(() => cuitSchema.parse('20-1234567-89')).toThrow()
  })
})

describe('socioEstadoSchema', () => {
  it('accepts all four valid states', () => {
    expect(socioEstadoSchema.parse('activo')).toBe('activo')
    expect(socioEstadoSchema.parse('suspendido')).toBe('suspendido')
    expect(socioEstadoSchema.parse('suspendido')).toBe('suspendido')
    expect(socioEstadoSchema.parse('baja')).toBe('baja')
  })
  it('rejects an unknown state', () => {
    expect(() => socioEstadoSchema.parse('muerto')).toThrow()
  })
})

describe('operatorRoleSchema', () => {
  it('accepts all four roles', () => {
    for (const r of ['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA'] as const) {
      expect(operatorRoleSchema.parse(r)).toBe(r)
    }
  })
  it('rejects an unknown role', () => {
    expect(() => operatorRoleSchema.parse('SUPERADMIN')).toThrow()
  })
})
