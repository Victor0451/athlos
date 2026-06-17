import { ErrorCode, BusinessError } from '@athlos/errors'

export type DomainFreshnessStatus = 'current' | 'stale' | 'unknown'

/**
 * Per-domain staleness thresholds (Decision 2: hard-coded in code, not config).
 *
 * ISO 8601 duration strings — parsed at module load into millisecond values.
 * Missing domain → BusinessError(CONFIG_MISSING).
 *
 * @see Decision 2: Freshness thresholds hard-coded in thresholds.ts
 */
export const DOMAIN_THRESHOLDS: Record<string, { staleAfter: string }> = {
  socios: { staleAfter: 'PT1H' }, // 1 hour
  ctacte: { staleAfter: 'PT1H' },
  ctacte1: { staleAfter: 'PT1H' },
  contable: { staleAfter: 'P1D' }, // 1 day
  contabl1: { staleAfter: 'P1D' },
  catastros: { staleAfter: 'P1D' },
  escuela: { staleAfter: 'P1D' },
  deportes: { staleAfter: 'PT12H' }, // 12 hours
  locacion: { staleAfter: 'P1D' },
  caja: { staleAfter: 'PT30M' }, // 30 min — cash is critical
  gastos: { staleAfter: 'PT12H' },
}

/**
 * Parse an ISO 8601 duration string to milliseconds.
 * Supports: PT#H (hours), PT#M (minutes), P#D (days), PT#S (seconds).
 * Does NOT support: weeks (P#W), months, years, or fractional values.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(?:P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/)
  if (!match) {
    return 0
  }
  const [, days, hours, minutes, seconds] = match
  const d = Number(days ?? 0)
  const h = Number(hours ?? 0)
  const m = Number(minutes ?? 0)
  const s = Number(seconds ?? 0)
  return (d * 24 * 60 * 60 + h * 60 * 60 + m * 60 + s) * 1000
}

/**
 * Get the threshold in ms for a given domain.
 * @throws BusinessError(CONFIG_MISSING) if domain not in DOMAIN_THRESHOLDS
 */
export function getThresholdMs(domain: string): number {
  const entry = DOMAIN_THRESHOLDS[domain]
  if (!entry) {
    throw BusinessError(
      ErrorCode.CONFIG_MISSING,
      `No freshness threshold configured for domain: ${domain}`,
      { domain },
    )
  }
  return parseDuration(entry.staleAfter)
}

/**
 * Map age in milliseconds against a threshold to a freshness status.
 *
 * @param ageMs    - age in ms (null = never imported)
 * @param thresholdMs - staleness threshold in ms
 */
export function ageToStatus(ageMs: number | null, thresholdMs: number): DomainFreshnessStatus {
  if (ageMs === null) return 'unknown'
  if (ageMs < thresholdMs) return 'current'
  if (ageMs > thresholdMs * 1.5) return 'stale'
  return 'current' // within 1.5× threshold — grace zone, still "current"
}

/**
 * Format age in milliseconds as a Spanish human-readable string.
 *
 * @param ageMs - age in ms (null = never imported)
 */
export function ageDisplay(ageMs: number | null): string {
  if (ageMs === null) return 'nunca'
  const m = Math.floor(ageMs / 60_000)
  if (m < 1) return 'hace menos de 1 min'
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} d`
}
