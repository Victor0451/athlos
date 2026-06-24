/**
 * Transform helpers — pure utility functions shared by all domain transforms.
 */

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
}
