/**
 * Transform helpers — pure utility functions shared by all domain transforms.
 */
import { createHash } from 'node:crypto'

/**
 * Deterministic UUID derived from a natural key.
 *
 * Uses SHA-256 hash of the natural key, formatted as a UUIDv5-like string
 * (with version + variant bits set per RFC 4122 §4.3). The same natural
 * key always produces the same UUID, enabling cross-run idempotency
 * via UNIQUE INDEX — re-runs of `pnpm db:promote` ON CONFLICT DO NOTHING.
 *
 * This is NOT a true UUIDv5 (which requires a namespace UUID + name), but
 * it produces a stable 128-bit hex string formatted as a UUID, which is
 * sufficient for our purposes (uniqueness across re-imports of the same
 * VFP natural key).
 */
export function deterministicUuid(naturalKey: string): string {
  const hash = createHash('sha256').update(naturalKey).digest()
  // Set version (5) in the high nibble of byte 6 and variant (10) in byte 8
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Parse a VFP date (YYYYMMDD compact string, ISO string, or Date instance)
 * into an ISO date string (YYYY-MM-DD) suitable for Drizzle date() columns.
 * Returns null on unparseable input.
 */
export function parseFechaVFP(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw.toISOString().split('T')[0]!
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (/^\d{8}$/.test(trimmed)) {
      const y = Number.parseInt(trimmed.slice(0, 4), 10)
      const m = Number.parseInt(trimmed.slice(4, 6), 10) - 1
      const d = Number.parseInt(trimmed.slice(6, 8), 10)
      const dt = new Date(y, m, d)
      return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0]!
    }
    const iso = new Date(trimmed)
    return isNaN(iso.getTime()) ? null : iso.toISOString().split('T')[0]!
  }
  if (typeof raw === 'number') {
    // Assume YYYYMMDD as integer
    const y = Math.floor(raw / 10000)
    const m = (Math.floor(raw / 100) % 100) - 1
    const d = raw % 100
    const dt = new Date(y, m, d)
    return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0]!
  }
  return null
}

/** Parse a monetary amount to NUMERIC(14,2) string. */
export function parseMonto(raw: unknown): string {
  if (raw === null || raw === undefined) return '0.00'
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/[^\d.-]/g, ''))
  if (Number.isNaN(n)) return '0.00'
  return n.toFixed(2)
}

/** Split monto into debe/haber based on tipo. */
export function splitDebeHaber(
  monto: string,
  tipo: 'DEBITO' | 'CREDITO',
): { debe: string; haber: string } {
  if (tipo === 'DEBITO') return { debe: monto, haber: '0.00' }
  return { debe: '0.00', haber: monto }
}

/** Split 'APELLIDO NOMBRE' into parts. */
export function splitApellidoNombre(full: string): { apellido: string; nombre: string } {
  if (!full || !full.trim()) return { apellido: '(sin apellido)', nombre: '(sin nombre)' }
  const parts = full.trim().split(/\s+/)
  const apellido = parts[0] ?? '(sin apellido)'
  const nombre = parts.slice(1).join(' ') || '(sin nombre)'
  return { apellido, nombre }
}

/** Typed FK map — namespaced keys for O(1) lookup. */
export interface FkMap {
  get(key: string): string | undefined
}

export interface TransformHelpers {
  fkMap: FkMap
  parseFechaVFP: typeof parseFechaVFP
  parseMonto: typeof parseMonto
  splitDebeHaber: typeof splitDebeHaber
  splitApellidoNombre: typeof splitApellidoNombre
  deterministicUuid: typeof deterministicUuid
}
