/**
 * Dedup by natural key.
 *
 * For socios: natural key is `SOCCARNET` → `numeroSocio`.
 *   Full dedup available: UNIQUE constraint on `socios.numeroSocio` + pre-check.
 *
 * For ctacte: compound key `${CCTCUENTA}|${CCTFECHA}|${CCTNROCOMP}|${CCTMES}|${CCTTALONAR}`.
 *   E1b1 fix: now produces a deterministic UUID via `deterministicUuid()` and
 *   stores it as `legacy_id` on master. UNIQUE INDEX on legacy_id enables
 *   cross-run idempotency via ON CONFLICT DO NOTHING.
 *
 * For ctacte1: 5-tuple `${CCTPAGONRO}|${CCTPAGOSEC}|${CCTPAGOTAL}|${CCTPAGOFAM}|${CCTCUENTA}`.
 *   Same legacy_id UNIQUE INDEX pattern as ctacte.
 *
 * loadExistingNaturalKeys reads existing legacy_ids from master so re-runs
 * skip already-promoted rows (pre-check) AND ON CONFLICT DO NOTHING skips
 * any duplicates that slipped through (defense in depth).
 */
import { isNotNull } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { ctacte, ctacte1, socios } from '@athlos/db/schema'

export type Domain = 'socios' | 'ctacte' | 'ctacte1'

/** Natural key extractor from VFP jsonb payload (used to derive legacy_id). */
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
  // ctacte1: 5-tuple compound key (verified 170,281 unique of 245,370 rows = 69% unique)
  return [
    payload['CCTPAGONRO'] ?? '',
    payload['CCTPAGOSEC'] ?? '',
    payload['CCTPAGOTAL'] ?? '',
    payload['CCTPAGOFAM'] ?? '',
    payload['CCTCUENTA'] ?? '',
  ].join('|')
}

/** Load existing natural keys already in master table (for dedup pre-check). */
export async function loadExistingNaturalKeys(db: Db, domain: Domain): Promise<Set<string>> {
  if (domain === 'socios') {
    const rows = await db.select({ numeroSocio: socios.numeroSocio }).from(socios)
    return new Set(rows.map((r) => r.numeroSocio))
  }
  if (domain === 'ctacte') {
    // Load existing legacy_ids (deterministic UUIDs) for cross-run dedup
    const rows = await db
      .select({ legacyId: ctacte.legacyId })
      .from(ctacte)
      .where(isNotNull(ctacte.legacyId))
    return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
  }
  if (domain === 'ctacte1') {
    // Load existing legacy_ids for cross-run dedup
    const rows = await db
      .select({ legacyId: ctacte1.legacyId })
      .from(ctacte1)
      .where(isNotNull(ctacte1.legacyId))
    return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
  }
  return new Set<string>()
}
