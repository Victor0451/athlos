import { describe, expect, it } from 'vitest'
import { buildFilename, sanitizeApellido } from './filename.ts'

/**
 * `buildFilename` + `sanitizeApellido` — filename sanitization for
 * the `solicitud-inscripcion` PDF download.
 *
 * Locks the contract per design §8 — the filename must be ASCII-only
 * (RFC 6266 + browser tab-name safety), keep the apellido readable
 * after diacritic stripping, and stay stable across re-emissions of
 * the same socio (so the operator's download-history search works).
 */

describe('sanitizeApellido', () => {
  it('strips diacritics from Spanish accented vowels', () => {
    expect(sanitizeApellido('Pérez')).toBe('PEREZ')
    expect(sanitizeApellido('García')).toBe('GARCIA')
    expect(sanitizeApellido('López')).toBe('LOPEZ')
  })

  it('replaces apostrophes with underscores', () => {
    expect(sanitizeApellido("O'Brien")).toBe('O_BRIEN')
  })

  it('collapses consecutive non-alphanumeric runs to a single underscore', () => {
    expect(sanitizeApellido('van  der  Berg')).toBe('VAN_DER_BERG')
    expect(sanitizeApellido('García López')).toBe('GARCIA_LOPEZ')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeApellido('')).toBe('')
  })

  it('returns empty string for input that is only special characters', () => {
    expect(sanitizeApellido('!!!')).toBe('')
    expect(sanitizeApellido('---')).toBe('')
    expect(sanitizeApellido("' '")).toBe('')
  })

  it('trims leading and trailing underscores after collapse', () => {
    expect(sanitizeApellido('__Pérez__')).toBe('PEREZ')
    expect(sanitizeApellido('---García---')).toBe('GARCIA')
  })

  it('passes ASCII letters and digits through unchanged (uppercased)', () => {
    expect(sanitizeApellido('Perez')).toBe('PEREZ')
    expect(sanitizeApellido('Smith3')).toBe('SMITH3')
  })

  it('uppercases everything', () => {
    expect(sanitizeApellido('pérez garcía')).toBe('PEREZ_GARCIA')
  })

  it('does not collapse mid-word underscores from allowed chars', () => {
    // Single underscore between two letters should NOT happen because
    // `_` is non-alphanumeric and gets replaced — but the result must
    // still be uppercase and contiguous.
    expect(sanitizeApellido('De_la_Cruz')).toBe('DE_LA_CRUZ')
  })
})

describe('buildFilename', () => {
  it('produces the canonical filename for a normal socio', () => {
    expect(buildFilename({ numeroSocio: '12345', apellido: 'Pérez' })).toBe(
      'solicitud-inscripcion-socio-12345-PEREZ.pdf',
    )
  })

  it('sanitizes the apellido end-to-end', () => {
    expect(buildFilename({ numeroSocio: 9999, apellido: "O'Brien" })).toBe(
      'solicitud-inscripcion-socio-9999-O_BRIEN.pdf',
    )
  })

  it('stringifies numeric numeroSocio', () => {
    expect(buildFilename({ numeroSocio: 7, apellido: 'García López' })).toBe(
      'solicitud-inscripcion-socio-7-GARCIA_LOPEZ.pdf',
    )
  })

  it('produces a bare-suffix filename when the apellido is empty after sanitization', () => {
    // The end-to-end shape still includes the `-` separator before the
    // empty apellido block — the spec pins "exact format" so we don't
    // collapse trailing separators.
    expect(buildFilename({ numeroSocio: '42', apellido: '' })).toBe(
      'solicitud-inscripcion-socio-42-.pdf',
    )
  })
})
