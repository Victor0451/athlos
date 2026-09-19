import { describe, expect, it } from 'vitest'
import { parseCashAmount } from './cash-amount'

describe('parseCashAmount', () => {
  it('parses plain pesos into exact cents', () => {
    expect(parseCashAmount('0')).toBe(0)
    expect(parseCashAmount('500')).toBe(50000)
    // Leading zeros are accepted; the value is numeric, not textual.
    expect(parseCashAmount('007')).toBe(700)
  })

  it('accepts comma or dot decimals with one or two places', () => {
    expect(parseCashAmount('3000,00')).toBe(300000)
    expect(parseCashAmount('5,5')).toBe(550)
    expect(parseCashAmount('5.55')).toBe(555)
    expect(parseCashAmount('0,01')).toBe(1)
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parseCashAmount(' 3000 ')).toBe(300000)
    expect(parseCashAmount('\t12,5\n')).toBe(1250)
  })

  it('rejects empty and truncated decimal shapes', () => {
    expect(parseCashAmount('')).toBeNull()
    expect(parseCashAmount('   ')).toBeNull()
    expect(parseCashAmount('.')).toBeNull()
    expect(parseCashAmount('1.')).toBeNull()
    expect(parseCashAmount(',5')).toBeNull()
    expect(parseCashAmount('5,')).toBeNull()
  })

  it('rejects signs, thousand separators, and extra decimals', () => {
    expect(parseCashAmount('-5')).toBeNull()
    expect(parseCashAmount('+5')).toBeNull()
    expect(parseCashAmount('3.000')).toBeNull()
    expect(parseCashAmount('1 000')).toBeNull()
    expect(parseCashAmount('5,555')).toBeNull()
  })

  it('rejects non-ASCII digits instead of guessing', () => {
    expect(parseCashAmount('٥٠٠')).toBeNull()
    expect(parseCashAmount('½')).toBeNull()
  })

  it('rejects input longer than 32 characters', () => {
    // 32 ones is still a valid shape, but its cents overflow MAX_SAFE_INTEGER.
    expect(parseCashAmount('1'.repeat(32))).toBeNull()
    expect(parseCashAmount('1'.repeat(33))).toBeNull()
  })

  it('rejects amounts beyond safe integer cents', () => {
    expect(parseCashAmount('9'.repeat(32))).toBeNull()
    // Number.MAX_SAFE_INTEGER cents == 90071992547409.91 pesos: exactly at the boundary.
    expect(parseCashAmount('90071992547409.91')).toBe(9007199254740991)
    expect(parseCashAmount('90071992547409.92')).toBeNull()
  })
})
