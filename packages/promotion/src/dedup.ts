/**
 * Dedup by natural key.
 *
 * For socios: natural key is `SOCCARNET` → `numeroSocio`.
 *   Full dedup available: UNIQUE constraint on `socios.numeroSocio` + pre-check.
 *
 * For ctacte: compound key `${CCTCUENTA}|${CCTFECHA}|${CCTNROCOMP}|${CCTMES}|${CCTTALONAR}`.
 *   PARTIAL dedup: ~78% unique (256k distinct of 326k); remaining duplicates
 *   are intra-batch only (since master has no UNIQUE constraint). E2 will
 *   add `legacy_id` column for full dedup.
 *
 * For ctacte1: compound key `${CCTPAGONRO}|${CCTPAGOSEC}|${CCTPAGOTAL}`.
 *   PARTIAL dedup: same limitation as ctacte. E2 will fix.
 */
import type { Db } from '@athlos/db'
import { socios } from '@athlos/db/schema'

export type Domain = 'socios' | 'ctacte' | 'ctacte1'

/** Natural key extractor from VFP jsonb payload. */
export function naturalKey(domain: Domain, payload: Record<string, unknown>): string {
  if (domain === 'socios') return String(payload['SOCCARNET'] ?? payload['SOCNUMERO'] ?? '')
  if (domain === 'ctacte') {
    // Compound key: cuenta + fecha + nrocomp + mes + talonario
    return [
      payload['CCTCUENTA'] ?? '',
      payload['CCTFECHA'] ?? '',
      payload['CCTNROCOMP'] ?? '',
      payload['CCTMES'] ?? '',
      payload['CCTTALONAR'] ?? '',
    ].join('|')
  }
  // ctacte1: compound key
  return [
    payload['CCTPAGONRO'] ?? '',
    payload['CCTPAGOSEC'] ?? '',
    payload['CCTPAGOTAL'] ?? '',
  ].join('|')
}

/** Load existing natural keys already in master table (for dedup pre-check). */
export async function loadExistingNaturalKeys(db: Db, domain: Domain): Promise<Set<string>> {
  if (domain === 'socios') {
    const rows = await db.select({ numeroSocio: socios.numeroSocio }).from(socios)
    return new Set(rows.map((r) => r.numeroSocio))
  }
  // ctacte and ctacte1 have no legacy_id column in E1a — dedup relies on ON CONFLICT DO NOTHING only.
  // Return empty set; skipped counter will only reflect intra-batch dedup.
  return new Set<string>()
}
