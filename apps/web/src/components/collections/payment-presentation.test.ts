import { describe, expect, it } from 'vitest'
import { formatObligationPeriod, formatShiftOption } from './payment-presentation'

describe('payment presentation', () => {
  it('formats obligation periods using UTC-safe Spanish month names', () => {
    expect(formatObligationPeriod('2026-08-01')).toBe('agosto de 2026')
  })

  it.each([
    [1, '2026-09-02', 'Turno 1 · 2 de septiembre de 2026'],
    [2, '2026-09-02T23:00:00.000Z', 'Turno 2 · 2 de septiembre de 2026'],
  ])(
    'formats indexed shifts without exposing raw identifiers or ISO dates',
    (index, date, label) => {
      expect(formatShiftOption(index, date)).toBe(label)
    },
  )
})
