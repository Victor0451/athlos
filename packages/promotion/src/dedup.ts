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
 * E1b2a adds 4 NEW domains:
 * - escuela: `ESCCODIGO` (integer → string)
 * - deportes: `DEPCODIGO` (integer → string, coerced to text)
 * - locacion: composite `${LCNCTAPRIN}|${LCNNUMERO}` (89 distinct = 100% unique)
 * - caja: 4-tuple `${CAJNUMERO}|${CAJSECUENC}|${CAJFECHA}|${CAJHORA}` (8145 distinct = 100% unique)
 *
 * loadExistingNaturalKeys reads existing legacy_ids from master so re-runs
 * skip already-promoted rows (pre-check) AND ON CONFLICT DO NOTHING skips
 * any duplicates that slipped through (defense in depth).
 *
 * E2 (this file): For ctacte/ctacte1, ALSO checks raw_events.promoted_at IS NOT NULL
 * as a secondary cross-check (belt-and-suspenders with master.legacy_id).
 * NOTE: Full cross-domain ctacte↔ctacte1 dedup requires raw_events.legacy_id (E3+).
 */
import { isNotNull, sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import {
  ctacte,
  ctacte1,
  socios,
  escuela,
  locacion,
  disciplinas,
  cajaMovimiento,
  gastos,
} from '@athlos/db/schema'

export type Domain =
  | 'socios'
  | 'ctacte'
  | 'ctacte1'
  | 'escuela'
  | 'deportes'
  | 'locacion'
  | 'caja'
  | 'gastos'

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
  if (domain === 'ctacte1') {
    // 5-tuple compound key (verified 170,281 unique of 245,370 rows = 69% unique)
    return [
      payload['CCTPAGONRO'] ?? '',
      payload['CCTPAGOSEC'] ?? '',
      payload['CCTPAGOTAL'] ?? '',
      payload['CCTPAGOFAM'] ?? '',
      payload['CCTCUENTA'] ?? '',
    ].join('|')
  }
  if (domain === 'escuela') return String(payload['ESCCODIGO'] ?? '')
  if (domain === 'deportes') return String(payload['DEPCODIGO'] ?? '')
  if (domain === 'locacion') {
    return [payload['LCNCTAPRIN'] ?? '', payload['LCNNUMERO'] ?? ''].join('|')
  }
  if (domain === 'caja') {
    return [
      payload['CAJNUMERO'] ?? '',
      payload['CAJSECUENC'] ?? '',
      payload['CAJFECHA'] ?? '',
      payload['CAJHORA'] ?? '',
    ].join('|')
  }
  if (domain === 'gastos') {
    // NEW (E1b2b): 5-tuple (verified 100% unique; 3-tuple had 1,768 duplicates)
    return [
      payload['GASTIPGAST'] ?? '',
      payload['GASCTAPRIN'] ?? '',
      payload['GASSECUENC'] ?? '',
      payload['GASFECHA'] ?? '',
      payload['GASCOMPROB'] ?? '',
    ].join('|')
  }
  return ''
}

/**
 * Load source_keys from raw_events where promoted_at IS NOT NULL (E2).
 * Belt-and-suspenders secondary cross-check for ctacte/ctacte1.
 * NOTE: Full ctacte↔ctacte1 cross-domain dedup requires raw_events.legacy_id (E3+).
 */
async function loadPromotedSourceKeys(db: Db, domain: Domain): Promise<Set<string>> {
  const rows = (await db.execute(
    sql`SELECT source_key FROM public.raw_events WHERE source_table = ${domain} AND promoted_at IS NOT NULL`,
  )) as unknown as { rows: { source_key: string }[] }
  return new Set(rows.rows.map((r) => r.source_key))
}

/** Load existing natural keys already in master table (for dedup pre-check).
 *  E2: for ctacte/ctacte1, MERGES master.legacy_id keys with raw_events.promoted_at
 *  source_keys as a secondary cross-check.
 */
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
    const legacyKeys = new Set(
      rows.map((r) => r.legacyId).filter((id): id is string => id !== null),
    )
    // E2: merge raw_events.promoted_at source_keys as secondary cross-check
    const promotedKeys = await loadPromotedSourceKeys(db, domain)
    for (const k of promotedKeys) legacyKeys.add(k)
    return legacyKeys
  }
  if (domain === 'ctacte1') {
    // Load existing legacy_ids for cross-run dedup
    const rows = await db
      .select({ legacyId: ctacte1.legacyId })
      .from(ctacte1)
      .where(isNotNull(ctacte1.legacyId))
    const legacyKeys = new Set(
      rows.map((r) => r.legacyId).filter((id): id is string => id !== null),
    )
    // E2: merge raw_events.promoted_at source_keys as secondary cross-check
    const promotedKeys = await loadPromotedSourceKeys(db, domain)
    for (const k of promotedKeys) legacyKeys.add(k)
    return legacyKeys
  }
  if (domain === 'escuela') {
    const rows = await db
      .select({ legacyId: escuela.legacyId })
      .from(escuela)
      .where(isNotNull(escuela.legacyId))
    return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
  }
  if (domain === 'deportes') {
    const rows = await db
      .select({ legacyId: disciplinas.legacyId })
      .from(disciplinas)
      .where(isNotNull(disciplinas.legacyId))
    return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
  }
  if (domain === 'locacion') {
    const rows = await db
      .select({ legacyId: locacion.legacyId })
      .from(locacion)
      .where(isNotNull(locacion.legacyId))
    return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
  }
  if (domain === 'caja') {
    const rows = await db
      .select({ legacyId: cajaMovimiento.legacyId })
      .from(cajaMovimiento)
      .where(isNotNull(cajaMovimiento.legacyId))
    return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
  }
  if (domain === 'gastos') {
    const rows = await db
      .select({ legacyId: gastos.legacyId })
      .from(gastos)
      .where(isNotNull(gastos.legacyId))
    return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
  }
  return new Set<string>()
}
