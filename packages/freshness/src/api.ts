import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import {
  ageToStatus,
  ageDisplay,
  getThresholdMs,
  type DomainFreshnessStatus,
} from './thresholds.js'

export interface DomainFreshness {
  domain: string
  lastImportAt: string | null
  recordCount: number
  status: DomainFreshnessStatus
  ageDisplay: string
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
