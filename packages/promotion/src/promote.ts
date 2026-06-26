/**
 * promote.ts — Core promotion algorithm.
 *
 * Reads rows from `*_projection` tables, transforms jsonb payloads into
 * typed Drizzle inserts, resolves FKs via bulk in-memory lookups, and
 * writes to master tables in batches of 1000 with ON CONFLICT DO NOTHING.
 *
 * E3 (N14 closure): ctacte/ctacte1 read DIRECTLY from raw_events
 * (projection tables are EMPTY for these domains). Uses legacy_id
 * (source-level dedup key) instead of source_key.
 */
import { sql } from 'drizzle-orm'
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
import {
  socios,
  ctacte,
  ctacte1,
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

    // E3 (N14 closure): ctacte/ctacte1 read DIRECTLY from raw_events.
    // Projection tables are EMPTY for these domains; source_key is degenerate.
    // Use legacy_id (source-level dedup key) instead of source_key.
    if (domain === 'ctacte' || domain === 'ctacte1') {
      // Read from raw_events directly — bypasses empty projection tables
      const rawRows =
        (
          await db.execute<{
            id: string
            source_key: string
            payload: Record<string, unknown>
            legacy_id: string
          }>(
            sql`SELECT id, source_key, payload, legacy_id
              FROM public.raw_events
              WHERE source_table = ${domain}
                AND legacy_id IS NOT NULL
                AND promoted_at IS NULL`,
          )
        ).rows ?? []
      result.attempted = rawRows.length

      // Build dedup set: UNION of master.legacy_id + raw_events.legacy_id
      const existingKeys = await loadExistingNaturalKeys(db, domain)

      // Track inserted raw_events.id for precise bulk UPDATE
      const insertedRawEventIds: string[] = []

      // buffer entries: { masterRow, rawEventId }
      type BufferEntry = { masterRow: unknown; rawEventId: string }
      const buffer: BufferEntry[] = []

      const flush = async () => {
        if (buffer.length === 0) return
        const masterRows = buffer.map((e) => e.masterRow)
        // Build legacyId→rawEventId map for correlation after insert
        const legacyIdToRawEventId = new Map<string, string>()
        for (const e of buffer) {
          const row = e.masterRow as Record<string, unknown>
          if (row.legacyId) legacyIdToRawEventId.set(row.legacyId as string, e.rawEventId)
        }
        const inserted = await insertMasterBatch(db, domain, masterRows)
        result.inserted += inserted.length
        result.skipped += buffer.length - inserted.length
        // Correlate inserted rows back to rawEvents via legacyId
        for (const row of inserted) {
          const rawEventId = row.legacyId
            ? legacyIdToRawEventId.get(row.legacyId as string)
            : undefined
          if (rawEventId) insertedRawEventIds.push(rawEventId)
        }
        buffer.length = 0
      }

      const helpers: TransformHelpers = {
        fkMap,
        parseFechaVFP,
        parseMonto,
        splitDebeHaber,
        splitApellidoNombre,
        deterministicUuid,
      }

      for (const row of rawRows) {
        try {
          const key = row.legacy_id // E3: legacy_id is the dedup key
          if (existingKeys.has(key)) {
            result.skipped++
            continue
          }
          const masterRow = transform(row.payload, helpers)
          buffer.push({ masterRow, rawEventId: row.id })
          existingKeys.add(key)
        } catch (err) {
          result.failed++
          result.errors.push({ sourceKey: row.source_key, reason: errMsg(err) })
        }
        if (buffer.length >= BATCH_SIZE) await flush()
      }
      await flush()

      // Bulk UPDATE: stamp promoted_at on raw_events by UUID PK (precise)
      if (insertedRawEventIds.length > 0) {
        await db.execute(sql`
          UPDATE public.raw_events
          SET promoted_at = now()
          WHERE id = ANY(${insertedRawEventIds}::uuid[])
        `)
      }

      result.durationMs = Date.now() - t0
      return result
    }

    // 2. Read all projection rows for this domain, FILTERED by raw_events.promoted_at IS NULL
    //    (E2: per-row idempotency — skips rows already stamped as promoted)
    const { schema: projSchema, table: projTableName } = PROJECTION_TABLE[domain]
    // Projection tables are created lazily by rebuild.ts with literal dots in the
    // table name (e.g. `public."socios.socios_projection"`). Quote schema and
    // table separately — DO NOT split on `.` (table names contain dots).
    // The JOIN filters out rows that have already been promoted (promoted_at IS NOT NULL).
    const projectionRows =
      (
        await db.execute<{ source_key: string; payload: Record<string, unknown> }>(
          `SELECT pe.source_key, pe.payload
           FROM "${projSchema}"."${projTableName}" pe
           JOIN public.raw_events re
             ON re.source_table = '${domain}'
            AND re.source_key = pe.source_key
            AND re.promoted_at IS NULL`,
        )
      ).rows ?? []
    result.attempted = projectionRows.length

    // 3. Build dedup set (natural keys already in master — belt-and-suspenders with ON CONFLICT)
    const existingKeys = await loadExistingNaturalKeys(db, domain)

    // 4. Track successfully inserted source_keys for bulk UPDATE (E2)
    const insertedSourceKeys: string[] = []

    // 5. Transform + batch insert
    let buffer: unknown[] = []
    let bufferKeys: string[] = []
    const flush = async () => {
      if (buffer.length === 0) return
      const inserted = await insertMasterBatch(db, domain, buffer)
      result.inserted += inserted.length
      result.skipped += buffer.length - inserted.length
      // Track source_keys for successfully inserted rows (E2 bulk UPDATE)
      // inserted.length rows were inserted; they correspond to the first inserted.length
      // entries in buffer (ON CONFLICT DO NOTHING preserves order)
      if (inserted.length > 0) {
        insertedSourceKeys.push(...bufferKeys.slice(0, inserted.length))
      }
      buffer = []
      bufferKeys = []
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
        bufferKeys.push(row.source_key)
        existingKeys.add(key)
      } catch (err) {
        result.failed++
        result.errors.push({ sourceKey: row.source_key, reason: errMsg(err) })
      }
      if (buffer.length >= BATCH_SIZE) await flush()
    }
    await flush()

    // 6. Bulk UPDATE: stamp all successfully-promoted rows in raw_events (E2)
    //    Single UPDATE per domain — atomic, fast (uses idx_raw_events_source_key)
    if (insertedSourceKeys.length > 0) {
      await db.execute(sql`
        UPDATE public.raw_events
        SET promoted_at = now()
        WHERE source_table = ${domain}
          AND source_key = ANY(${insertedSourceKeys}::varchar[])
      `)
    }
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

async function insertMasterBatch(
  db: Db,
  domain: Domain,
  rows: unknown[],
): Promise<{ id: unknown; legacyId?: unknown }[]> {
  if (rows.length === 0) return []

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
  } else if (domain === 'ctacte1') {
    inserted = await db
      .insert(ctacte1)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: ctacte1.id })
  } else if (domain === 'escuela') {
    inserted = await db
      .insert(escuela)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: escuela.id })
  } else if (domain === 'deportes') {
    inserted = await db
      .insert(disciplinas)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: disciplinas.id })
  } else if (domain === 'locacion') {
    inserted = await db
      .insert(locacion)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: locacion.id })
  } else if (domain === 'caja') {
    inserted = await db
      .insert(cajaMovimiento)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: cajaMovimiento.id })
  } else if (domain === 'gastos') {
    inserted = await db
      .insert(gastos)
      .values(rows as unknown as never[])
      .onConflictDoNothing()
      .returning({ id: gastos.id })
  }

  return inserted
}
