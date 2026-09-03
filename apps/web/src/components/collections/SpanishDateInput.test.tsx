import { describe, expect, it } from 'vitest'
import { formatSpanishDate, parseSpanishDate } from './SpanishDateInput'

describe('SpanishDateInput date helpers', () => {
  it('parses and formats leap-year calendar dates', () => {
    expect(parseSpanishDate('29/02/2024')).toBe('2024-02-29')
    expect(formatSpanishDate('2024-02-29')).toBe('29/02/2024')
  })

  it.each(['29/02/2023', '31/04/2026', '00/01/2026', '01/13/2026'])(
    'rejects impossible date %s',
    (value) => {
      expect(parseSpanishDate(value)).toBeNull()
    },
  )

  it.each(['', '1/01/2026', '01/1/2026', '01/01/26', '01/01/202'])(
    'rejects incomplete date %s',
    (value) => {
      expect(parseSpanishDate(value)).toBeNull()
    },
  )
})
