import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { domainFreshness } from '@athlos/db/schema'
import {
  ageToStatus,
  ageDisplay,
  getThresholdMs,
  type DomainFreshnessStatus,
} from './thresholds.ts'

export interface DomainFreshness {
  domain: string
  lastImportAt: string | null
  recordCount: number
  status: DomainFreshnessStatus
  ageDisplay: string
}

export interface RefreshResult {
  domain: string
  lastImportAt: Date | null
  recordCount: number
}

interface DbDomainFreshnessRow {
  domain: string
  last_import_at: Date | null
  record_count: number
  refreshed_at: Date
}

/**
 * Read the domain_freshness cache table and compute status + ageDisplay per row.
 *
 * @param db    - Drizzle DB client
 * @param opts - optional domain filter; absent = all domains
 */
export async function getFreshness(
  db: Db,
  opts: { domain?: string } = {},
): Promise<DomainFreshness[]> {
  const rows = (await db.execute(
    opts.domain
      ? sql`SELECT domain, last_import_at, record_count, refreshed_at FROM domain_freshness WHERE domain = ${opts.domain}`
      : sql`SELECT domain, last_import_at, record_count, refreshed_at FROM domain_freshness`,
  )) as unknown as { rows: DbDomainFreshnessRow[] }

  const now = Date.now()

  return rows.rows.map((row) => {
    const ageMs = row.last_import_at ? now - row.last_import_at.getTime() : null
    const thresholdMs = getThresholdMs(row.domain)
    const status = ageToStatus(ageMs, thresholdMs)
    const display = ageDisplay(ageMs)

    return {
      domain: row.domain,
      lastImportAt: row.last_import_at?.toISOString() ?? null,
      recordCount: row.record_count,
      status,
      ageDisplay: display,
    }
  })
}

/**
 * Refresh the domain_freshness cache table by computing fresh stats from raw_events.
 *
 * Computes MAX(imported_at) + COUNT(*) per domain from raw_events,
 * then upserts into domain_freshness.
 *
 * @param db - Drizzle DB client
 * @param opts - optional domain filter; absent = all known domains
 * @returns the refresh results per domain
 */
export async function refreshAll(db: Db, opts: { domain?: string } = {}): Promise<RefreshResult[]> {
  // Compute fresh stats from raw_events
  const stats = (await db.execute(
    opts.domain
      ? sql`
        SELECT
          source_table AS domain,
          MAX(imported_at) AS last_import_at,
          COUNT(*)         AS record_count
        FROM raw_events
        WHERE source_table = ${opts.domain}
        GROUP BY source_table
      `
      : sql`
        SELECT
          source_table AS domain,
          MAX(imported_at) AS last_import_at,
          COUNT(*)         AS record_count
        FROM raw_events
        GROUP BY source_table
      `,
  )) as unknown as {
    rows: Array<{ domain: string; last_import_at: Date | null; record_count: number }>
  }

  const now = new Date()
  const results: RefreshResult[] = []

  for (const stat of stats.rows) {
    await db
      .insert(domainFreshness)
      .values({
        domain: stat.domain,
        lastImportAt: stat.last_import_at,
        recordCount: stat.record_count,
        refreshedAt: now,
      })
      .onConflictDoUpdate({
        target: domainFreshness.domain,
        set: {
          lastImportAt: stat.last_import_at,
          recordCount: stat.record_count,
          refreshedAt: now,
        },
      })

    results.push({
      domain: stat.domain,
      lastImportAt: stat.last_import_at,
      recordCount: stat.record_count,
    })
  }

  return results
}
