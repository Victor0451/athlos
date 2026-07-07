import { describe, expect, it } from 'vitest'
import { validateMagic, type AllowedMime } from './magic-byte.ts'

/**
 * `validateMagic(declared, buffer)` — exact byte table from
 * `openspec/changes/athlos-socio-legajo/specs/file-storage/spec.md`
 * §"V1 Magic-Byte Table" and design §5.
 *
 * The validator is a PURE FUNCTION: same (declared, buffer) → same
 * boolean. The test fixture is the canonical byte sequences from the
 * spec; invalid variations are constructed by flipping single bytes
 * to verify the rejection paths.
 */

function jpeg(): Buffer {
  // FF D8 FF E0 ... (JFIF) — header is enough; trailer is not asserted.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
}

function png(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
}

function gif87a(): Buffer {
  // GIF87a — bytes 4='7' (0x37), 5='a' (0x61)
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01])
}

function gif89a(): Buffer {
  // GIF89a — bytes 4='8' (0x38), 5='a' (0x61)
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x38, 0x61, 0x01, 0x00, 0x01])
}

function webp(): Buffer {
  // RIFF????WEBP — bytes 0..3 = 'RIFF', bytes 8..11 = 'WEBP'
  return Buffer.from([
    0x52,
    0x49,
    0x46,
    0x46, // RIFF
    0x1a,
    0x00,
    0x00,
    0x00, // size (doesn't matter)
    0x57,
    0x45,
    0x42,
    0x50, // WEBP
    0x56,
    0x50,
    0x38,
    0x4c, // VP8L (lossless bitstream)
  ])
}

function pdf(): Buffer {
  // %PDF-1.7 ... %%EOF — trailer must be in the trailing 1024 bytes.
  const head = Buffer.from('%PDF-1.7\n%\x80\x80\x80\x80\n', 'binary')
  const body = Buffer.alloc(500, 0x20)
  const tail = Buffer.from('\n%%EOF\n', 'binary')
  return Buffer.concat([head, body, tail])
}

describe('validateMagic — happy path: each declared MIME accepts its canonical buffer', () => {
  const cases: Array<[AllowedMime, () => Buffer]> = [
    ['image/jpeg', jpeg],
    ['image/png', png],
    ['image/gif', gif87a],
    ['image/webp', webp],
    ['application/pdf', pdf],
  ]

  for (const [declared, make] of cases) {
    it(`accepts a valid ${declared} buffer`, () => {
      expect(validateMagic(declared, make())).toBe(true)
    })
  }
})

describe('validateMagic — declared MIME is not in the allow-list', () => {
  it('returns false for an unknown declared type', () => {
    expect(validateMagic('application/zip', jpeg())).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(validateMagic('', jpeg())).toBe(false)
  })
})

describe('validateMagic — buffer / declared mismatch', () => {
  it('rejects a JPEG-declared buffer that is actually PNG', () => {
    expect(validateMagic('image/jpeg', png())).toBe(false)
  })

  it('rejects a PNG-declared buffer that is actually JPEG', () => {
    expect(validateMagic('image/png', jpeg())).toBe(false)
  })

  it('rejects a PDF-declared buffer that is actually JPEG', () => {
    expect(validateMagic('application/pdf', jpeg())).toBe(false)
  })

  it('rejects an empty buffer for every MIME', () => {
    const empty = Buffer.alloc(0)
    expect(validateMagic('image/jpeg', empty)).toBe(false)
    expect(validateMagic('image/png', empty)).toBe(false)
    expect(validateMagic('image/gif', empty)).toBe(false)
    expect(validateMagic('image/webp', empty)).toBe(false)
    expect(validateMagic('application/pdf', empty)).toBe(false)
  })
})

describe('validateMagic — JPEG leading bytes', () => {
  it('accepts FF D8 FF followed by any non-empty byte', () => {
    // FF D8 FF is the minimum; the 4th byte may be E0/E1/FE/etc.
    expect(validateMagic('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xfe]))).toBe(true)
  })

  it('rejects FF D8 00 (3rd byte wrong)', () => {
    expect(validateMagic('image/jpeg', Buffer.from([0xff, 0xd8, 0x00]))).toBe(false)
  })

  it('rejects 00 D8 FF (1st byte wrong)', () => {
    expect(validateMagic('image/jpeg', Buffer.from([0x00, 0xd8, 0xff]))).toBe(false)
  })
})

describe('validateMagic — PNG leading bytes', () => {
  it('rejects 89 50 4E 47 0D 0A 1A 00 (final byte wrong)', () => {
    expect(
      validateMagic('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00])),
    ).toBe(false)
  })

  it('accepts the canonical 8-byte PNG header', () => {
    expect(validateMagic('image/png', png())).toBe(true)
  })
})

describe('validateMagic — GIF 87a vs 89a distinction', () => {
  it('accepts GIF87a (byte 4 = 0x37)', () => {
    expect(validateMagic('image/gif', gif87a())).toBe(true)
  })

  it('accepts GIF89a (byte 4 = 0x38)', () => {
    expect(validateMagic('image/gif', gif89a())).toBe(true)
  })

  it('rejects a buffer with byte 4 = 0x36 ("GIF86a" — non-standard)', () => {
    expect(validateMagic('image/gif', Buffer.from([0x47, 0x49, 0x46, 0x38, 0x36, 0x61]))).toBe(
      false,
    )
  })

  it('rejects a buffer with byte 5 != "a" (e.g. "GIF89b")', () => {
    expect(validateMagic('image/gif', Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x62]))).toBe(
      false,
    )
  })
})

describe('validateMagic — WEBP RIFF + WEBP at offset 8', () => {
  it('rejects RIFF header without WEBP at offset 8 (e.g. AVI file)', () => {
    // RIFF....AVI  — AVI uses RIFF too but with "AVI " at offset 8.
    expect(
      validateMagic(
        'image/webp',
        Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]),
      ),
    ).toBe(false)
  })

  it('rejects WEBP at offset 8 without RIFF at offset 0', () => {
    // bytes 0..3 = "JUNK" instead of RIFF.
    expect(
      validateMagic(
        'image/webp',
        Buffer.from([0x4a, 0x55, 0x4e, 0x4b, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe(false)
  })

  it('rejects when buffer is shorter than 12 bytes (cannot read offset 8)', () => {
    expect(
      validateMagic('image/webp', Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00])),
    ).toBe(false)
  })
})

describe('validateMagic — PDF trailer (%%EOF in trailing 1024 bytes)', () => {
  it('rejects a PDF-declared buffer without %%EOF in the trailing 1024 bytes', () => {
    // PDF header present, but trailer is far in the middle and we strip it.
    const head = Buffer.from('%PDF-1.7\n', 'binary')
    const filler = Buffer.alloc(2000, 0x20) // > 1024 bytes of filler AFTER the head
    const buf = Buffer.concat([head, filler])
    expect(validateMagic('application/pdf', buf)).toBe(false)
  })

  it('accepts a PDF whose %%EOF lives exactly at the 1024-byte boundary', () => {
    // header + filler sized so %%EOF is the last 5 bytes (i.e. within last 1024).
    const head = Buffer.from('%PDF-1.7\n', 'binary')
    const filler = Buffer.alloc(1100, 0x20)
    const trailer = Buffer.from('%%EOF', 'binary')
    const buf = Buffer.concat([head, filler, trailer])
    expect(validateMagic('application/pdf', buf)).toBe(true)
  })

  it('rejects when the buffer ends before %%EOF can be reached', () => {
    // tiny PDF-like header with no trailer at all
    expect(validateMagic('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(false)
  })
})
