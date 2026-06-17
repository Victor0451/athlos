import { describe, it, expect } from 'vitest'
import { DOMAIN_THRESHOLDS, ageToStatus, ageDisplay } from './thresholds.js'

describe('DOMAIN_THRESHOLDS', () => {
  /**
   * RED: Verifies all 11 domains are present with valid ISO 8601 durations.
   */

  it('has all 11 domains defined', () => {
    const domains = [
      'socios',
      'ctacte',
      'ctacte1',
      'contable',
      'contabl1',
      'catastros',
      'escuela',
      'deportes',
      'locacion',
      'caja',
      'gastos',
    ]
    for (const domain of domains) {
      const entry = DOMAIN_THRESHOLDS[domain as keyof typeof DOMAIN_THRESHOLDS]
      expect(entry).toBeDefined()
      expect(entry!.staleAfter).toMatch(/^P/)
    }
  })

  it('has 11 entries total', () => {
    expect(Object.keys(DOMAIN_THRESHOLDS)).toHaveLength(11)
  })
})

describe('ageToStatus', () => {
  /**
   * RED: Maps age in ms against threshold to status.
   * - null age → 'unknown'
   * - age < threshold → 'current'
   * - threshold < age < threshold × 1.5 → 'current' (grace zone)
   * - age > threshold × 1.5 → 'stale'
   */

  it('null age returns unknown', () => {
    expect(ageToStatus(null, 3_600_000)).toBe('unknown')
  })

  it('age within threshold returns current', () => {
    expect(ageToStatus(30 * 60 * 1000, 60 * 60 * 1000)).toBe('current') // 30min < 1h
  })

  it('age just above threshold but within 1.5x returns current (grace zone)', () => {
    const threshold = 60 * 60 * 1000 // 1h
    const age = threshold * 1.2 // 1.2h = just above threshold but below 1.5x
    expect(ageToStatus(age, threshold)).toBe('current')
  })

  it('age above 1.5x threshold returns stale', () => {
    const threshold = 60 * 60 * 1000 // 1h
    const age = threshold * 2 // 2h > 1.5x threshold
    expect(ageToStatus(age, threshold)).toBe('stale')
  })

  it('zero age returns current', () => {
    expect(ageToStatus(0, 3_600_000)).toBe('current')
  })

  it('age equal to threshold returns current', () => {
    expect(ageToStatus(3_600_000, 3_600_000)).toBe('current')
  })
})

describe('ageDisplay', () => {
  /**
   * RED: Formats age in ms as Spanish "hace N min/h/d".
   * - null → 'nunca'
   * - < 1 min → 'hace menos de 1 min'
   * - N min → 'hace N min'
   * - N h → 'hace N h'
   * - N d → 'hace N d'
   */

  it('null returns nunca', () => {
    expect(ageDisplay(null)).toBe('nunca')
  })

  it('zero returns hace menos de 1 min', () => {
    expect(ageDisplay(0)).toBe('hace menos de 1 min')
  })

  it('less than 1 min returns hace menos de 1 min', () => {
    expect(ageDisplay(30_000)).toBe('hace menos de 1 min')
  })

  it('1 min returns hace 1 min', () => {
    expect(ageDisplay(60_000)).toBe('hace 1 min')
  })

  it('5 min returns hace 5 min', () => {
    expect(ageDisplay(5 * 60_000)).toBe('hace 5 min')
  })

  it('59 min returns hace 59 min', () => {
    expect(ageDisplay(59 * 60_000)).toBe('hace 59 min')
  })

  it('1 hour returns hace 1 h', () => {
    expect(ageDisplay(60 * 60_000)).toBe('hace 1 h')
  })

  it('2 hours returns hace 2 h', () => {
    expect(ageDisplay(2 * 60 * 60_000)).toBe('hace 2 h')
  })

  it('23 hours returns hace 23 h', () => {
    expect(ageDisplay(23 * 60 * 60_000)).toBe('hace 23 h')
  })

  it('1 day returns hace 1 d', () => {
    expect(ageDisplay(24 * 60 * 60_000)).toBe('hace 1 d')
  })

  it('3 days returns hace 3 d', () => {
    expect(ageDisplay(3 * 24 * 60 * 60_000)).toBe('hace 3 d')
  })
})
