/**
 * promote.ts — Core promotion algorithm.
 *
 * Reads rows from `*_projection` tables, transforms jsonb payloads into
 * typed Drizzle inserts, resolves FKs via bulk in-memory lookups, and
 * writes to master tables in batches of 1000 with ON CONFLICT DO NOTHING.
 */
import type { Db } from '@athlos/db'
import { buildFkMap } from './fk-lookup.ts'
import { loadExistingNaturalKeys, naturalKey } from './dedup.ts'
import {
  PROMOTION_ORDER,
  FK_BLOCKING_DOMAINS,
  PROJECTION_TABLE,
  DOMAIN_TRANSFORMS,
} from './PROMOTION_ORDER.ts'
import {
  parseFechaVFP,
  parseMonto,
  splitDebeHaber,
  splitApellidoNombre,
  deterministicUuid,
} from './transform-helpers.ts'
import type { TransformHelpers } from './transform-helpers.ts'
import { socios, ctacte, ctacte1 } from '@athlos/db/schema'

export type Domain = 'socios' | 'ctacte' | 'ctacte1'

export interface PromotionResult {
  domain: Domain
  attempted: number
  inserted: number
  skipped: number
  failed: number
  errors: Array<{ sourceKey: string; reason: string }>
  durationMs: number
}

const BATCH_SIZE = 1000

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export async function promoteDomain(db: Db, domain: Domain): Promise<PromotionResult> {
  const t0 = Date.now()
  const result: PromotionResult = {
    domain,
    attempted: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    durationMs: 0,
  }

  try {
    const transform = DOMAIN_TRANSFORMS[domain]
    if (!transform) throw new Error(`No transform for domain ${domain}`)

    // 1. Bulk FK lookup (1 SELECT per domain — the O(1) optimization)
    const fkMap = await buildFkMap(db, domain)

    // 2. Read all projection rows for this domain (full scan; E2 will add `promoted_at` filter)
    const { schema: projSchema, table: projTableName } = PROJECTION_TABLE[domain]
    // Projection tables are created lazily by rebuild.ts with literal dots in the
    // table name (e.g. `public."socios.socios_projection"`). Quote schema and
    // table separately — DO NOT split on `.` (table names contain dots).
    const projectionRows =
      (
        await db.execute<{ source_key: string; payload: Record<string, unknown> }>(
          `SELECT source_key, payload FROM "${projSchema}"."${projTableName}"`,
        )
      ).rows ?? []
    result.attempted = projectionRows.length

    // 3. Build dedup set (natural keys already in master — belt-and-suspenders with ON CONFLICT)
    const existingKeys = await loadExistingNaturalKeys(db, domain)

    // 4. Transform + batch insert
    let buffer: unknown[] = []
    const flush = async () => {
      if (buffer.length === 0) return
      const inserted = await insertMasterBatch(db, domain, buffer)
      result.inserted += inserted
      result.skipped += buffer.length - inserted
      buffer = []
    }

    const helpers: TransformHelpers = {
      fkMap,
      parseFechaVFP,
      parseMonto,
      splitDebeHaber,
      splitApellidoNombre,
      deterministicUuid,
    }
    for (const row of projectionRows) {
      try {
        const key = naturalKey(domain, row.payload)
        if (existingKeys.has(key)) {
          result.skipped++
          continue
        }
        const masterRow = transform(row.payload, helpers)
        buffer.push(masterRow)
        existingKeys.add(key)
      } catch (err) {
        result.failed++
        result.errors.push({ sourceKey: row.source_key, reason: errMsg(err) })
      }
      if (buffer.length >= BATCH_SIZE) await flush()
    }
    await flush()
  } catch (err) {
    result.errors.push({ sourceKey: '*', reason: errMsg(err) })
  }

  result.durationMs = Date.now() - t0
  return result
}

export async function promoteAll(db: Db): Promise<PromotionResult[]> {
  const results: PromotionResult[] = []
  for (const domain of PROMOTION_ORDER) {
    const r = await promoteDomain(db, domain)
    results.push(r)
    // FK cascade short-circuit: block dependents if upstream was attempted but
    // failed 100% (inserted === 0 AND failed === attempted AND attempted > 0).
    // This means: don't short-circuit on RE-RUNS where all rows were skipped
    // via dedup (attempted > 0 but skipped dominates) — re-runs should still
    // attempt downstream domains in case new projection rows exist.
    if (
      FK_BLOCKING_DOMAINS.includes(domain) &&
      r.inserted === 0 &&
      r.failed > 0 &&
      r.failed === r.attempted
    ) {
      for (const downstream of PROMOTION_ORDER.slice(PROMOTION_ORDER.indexOf(domain) + 1)) {
        results.push({
          domain: downstream,
          attempted: 0,
          inserted: 0,
          skipped: 0,
          failed: 0,
          errors: [{ sourceKey: '*', reason: `Skipped due to upstream failure in ${domain}` }],
          durationMs: 0,
        })
      }
      break
    }
  }
  return results
}

async function insertMasterBatch(db: Db, domain: Domain, rows: unknown[]): Promise<number> {
  if (rows.length === 0) return 0

  let inserted: { id: unknown }[] = []

  if (domain === 'socios') {
    inserted = await db
      .insert(socios)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: socios.id })
  } else if (domain === 'ctacte') {
    inserted = await db
      .insert(ctacte)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: ctacte.id })
  } else {
    inserted = await db
      .insert(ctacte1)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: ctacte1.id })
  }

  return inserted.length
}
