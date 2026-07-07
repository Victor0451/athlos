/**
 * Magic-byte MIME validator — pure function.
 *
 * Accepts a `declared` MIME string and a `buffer`, returns `true` only
 * when the buffer's leading bytes (and, for PDFs only, trailing
 * 1024 bytes) match the v1 byte table.
 *
 * The byte table is pinned in:
 *   - openspec/changes/athlos-socio-legajo/specs/file-storage/spec.md
 *     §"V1 Magic-Byte Table"
 *   - openspec/changes/athlos-socio-legajo/design.md §5
 *
 * Client-declared `Content-Type` and filename extension are IGNORED
 * — only the sniffed bytes count. This blocks the "declared PDF,
 * actual EXE" attack vector.
 */

export type AllowedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf'

/**
 * Pinned byte table. `first` matches bytes at offset 0; `tail` (PDF only)
 * must appear in the trailing 1024 bytes; `webpAt8` (WEBP only) must
 * match bytes at offset 8..12.
 *
 * Stored as Buffers so equality is byte-exact (no string-encoding surprises).
 */
interface MagicSpec {
  first: Buffer
  tail?: Buffer
  webpAt8?: Buffer
}

const MAGIC_BYTES: Record<AllowedMime, MagicSpec> = {
  'image/jpeg': { first: Buffer.from([0xff, 0xd8, 0xff]) },
  'image/png': {
    first: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  'image/gif': { first: Buffer.from([0x47, 0x49, 0x46, 0x38]) }, // 'GIF8' — also assert '7a' or '8a' at offsets 4..5
  'image/webp': {
    first: Buffer.from([0x52, 0x49, 0x46, 0x46]), // 'RIFF'
    webpAt8: Buffer.from([0x57, 0x45, 0x42, 0x50]), // 'WEBP' at offset 8
  },
  'application/pdf': {
    first: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), // '%PDF-'
    tail: Buffer.from([0x25, 0x25, 0x45, 0x4f, 0x46]), // '%%EOF' must appear in trailing 1024 bytes
  },
}

/**
 * Validate the leading bytes (and PDF trailer) of `buffer` against the
 * magic-byte table for `declared`.
 *
 * Returns `false` (not throws) when:
 *   - `declared` is not in the allow-list
 *   - `buffer` is shorter than the leading-byte window
 *   - any leading byte mismatch
 *   - GIF byte-4/byte-5 mismatch
 *   - WEBP byte-8..12 mismatch
 *   - PDF `%%EOF` missing from the trailing 1024 bytes
 *
 * Pure function — no I/O, no side effects.
 */
export function validateMagic(declared: string, buffer: Buffer): boolean {
  const spec = MAGIC_BYTES[declared as AllowedMime]
  if (!spec) return false
  if (buffer.length < spec.first.length) return false
  if (!buffer.subarray(0, spec.first.length).equals(spec.first)) return false

  if (declared === 'image/gif') {
    // GIF must be GIF87a (byte 4 = '7') or GIF89a (byte 4 = '8'),
    // and byte 5 must be 'a'.
    const v4 = buffer[4]
    const v5 = buffer[5]
    if (v4 !== 0x37 /* '7' */ && v4 !== 0x38 /* '8' */) return false
    if (v5 !== 0x61 /* 'a' */) return false
  }

  if (declared === 'image/webp' && spec.webpAt8) {
    // Need 12 bytes to read offset 8..11.
    if (buffer.length < 12) return false
    if (!buffer.subarray(8, 12).equals(spec.webpAt8)) return false
  }

  if (declared === 'application/pdf' && spec.tail) {
    const window = Math.min(1024, buffer.length)
    const tail = buffer.subarray(buffer.length - window)
    if (tail.indexOf(spec.tail) === -1) return false
  }

  return true
}
