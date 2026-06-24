/**
 * Dedup by natural key.
 *
 * For socios: natural key is `SOCCARNET` / `SOCNUMERO` → `numeroSocio`.
 *   Full dedup available: UNIQUE constraint on `socios.numeroSocio` + pre-check.
 *
 * For ctacte: natural key is `CCTNUMERO`.
 *   PARTIAL dedup: no legacy_id column on ctacte master; relies on
 *   `ON CONFLICT DO NOTHING` only. E2 will add `legacy_id` column.
 *
 * For ctacte1: natural key is composite `${CCT1NUMERO}-${CCT1ITEM}`.
 *   PARTIAL dedup: same limitation as ctacte. E2 will fix.
 */
import type { Db } from '@athlos/db'
import { socios } from '@athlos/db/schema'

export type Domain = 'socios' | 'ctacte' | 'ctacte1'

/** Natural key extractor from VFP jsonb payload. */
export function naturalKey(domain: Domain, payload: Record<string, unknown>): string {
  if (domain === 'socios') return String(payload.SOCCARNET ?? payload.SOCNUMERO ?? '')
  if (domain === 'ctacte') return String(payload.CCTNUMERO ?? '')
  // ctacte1: composite key
  const num = String(payload.CCT1NUMERO ?? '')
  const item = String(payload.CCT1ITEM ?? '0')
  return `${num}-${item}`
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
