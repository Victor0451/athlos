import { and, eq } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { auditEvents, notifications, operators, type Operator } from '@athlos/db/schema'

/**
 * In-memory Drizzle standin for the notifications tests. Covers
 * the surface the dispatcher actually exercises: insert/select
 * on `notifications` and `operators`, insert on `audit_events`,
 * and a couple of equality filters.
 *
 * Mirrors the design of `apps/api/src/test-standins/db.ts` but
 * trimmed down — the dispatcher's contracts are narrower than
 * the admin routes'. The standin does NOT support joins,
 * transactions, ORDER BY, or aggregations.
 */

interface StandinState {
  operators: Operator[]
  notifications: Array<{
    id: string
    channel: string
    recipientId: string | null
    recipientAddress: string | null
    subject: string | null
    body: string
    metadata: Record<string, unknown>
    eventId: string | null
    status: 'pending' | 'sent' | 'failed' | 'read'
    readAt: Date | null
    createdAt: Date
  }>
  auditEvents: Array<{
    id: string
    operatorId: string | null
    action: string
    entityType: string
    entityId: string
    oldValue: unknown
    newValue: unknown
    sourceIp: string | null
    metadata: unknown
    idempotencyKey: string | null
    createdAt: Date
  }>
}

export interface StandinDb {
  state: StandinState
  reset(): void
  drizzle: Db
}

let counter = 0
function newId(): string {
  counter += 1
  return `id-${counter.toString().padStart(6, '0')}-${Date.now().toString(16)}`
}

export function createStandinDb(): StandinDb {
  const state: StandinState = {
    operators: [],
    notifications: [],
    auditEvents: [],
  }

  function asDrizzle(): Db {
    return {
      select(projection?: Record<string, unknown>) {
        return {
          from(table: unknown) {
            return {
              where(cond: unknown) {
                const filter = cond
                const result = filterAndProject(
                  state,
                  table,
                  filter,
                  projection,
                  Number.MAX_SAFE_INTEGER,
                )
                const rows: unknown[] = result
                return {
                  limit(n: number) {
                    return Promise.resolve(rows.slice(0, n))
                  },
                  then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
                    return Promise.resolve(rows).then(onFulfilled, onRejected)
                  },
                }
              },
            }
          },
        }
      },
      insert(table: unknown) {
        return {
          values(v: Record<string, unknown>) {
            const built = {
              returning(cols?: Record<string, unknown>) {
                const row = insertRow(state, table, v)
                if (row) {
                  if (cols)
                    return Promise.resolve([projectRow(row as Record<string, unknown>, cols)])
                  return Promise.resolve([row])
                }
                return Promise.resolve([])
              },
              then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
                // `insert(t).values(v)` without `.returning(...)` is
                // a valid Drizzle pattern — the dispatcher uses it
                // for write-only paths. Make the chain awaitable.
                const row = insertRow(state, table, v)
                return Promise.resolve(row ? [row] : []).then(onFulfilled, onRejected)
              },
            }
            return built
          },
        }
      },
    } as unknown as Db
  }

  return {
    state,
    reset() {
      state.operators.length = 0
      state.notifications.length = 0
      state.auditEvents.length = 0
    },
    drizzle: asDrizzle(),
  }
}

/** Convenience helper for tests that need the Drizzle handle. */
export function asDrizzle(standin: StandinDb): Db {
  return (standin as StandinDb & { drizzle: Db }).drizzle
}

type NotificationRow = StandinState['notifications'][number]
type AuditRow = StandinState['auditEvents'][number]

function insertRow(state: StandinState, table: unknown, v: Record<string, unknown>): unknown {
  const tname = tableName(table)
  if (tname === 'notifications') {
    // The dispatcher dedups at the EVENT level (via
    // `isDuplicate`) before fanning out — not at the row level.
    // Multiple in-app rows for the same event (one per recipient)
    // are allowed and expected. The standin therefore does not
    // enforce a unique constraint on `event_id`; the dispatcher
    // uses a non-unique index in production.
    const row: NotificationRow = {
      id: newId(),
      channel: String(v['channel'] ?? 'in_app'),
      recipientId: (v['recipientId'] as string | null) ?? null,
      recipientAddress: (v['recipientAddress'] as string | null) ?? null,
      subject: (v['subject'] as string | null) ?? null,
      body: String(v['body'] ?? ''),
      metadata: (v['metadata'] as Record<string, unknown>) ?? {},
      eventId: (v['eventId'] as string | null) ?? null,
      status: (v['status'] as NotificationRow['status']) ?? 'pending',
      readAt: (v['readAt'] as Date | null) ?? null,
      createdAt: (v['createdAt'] as Date) ?? new Date(),
    }
    state.notifications.push(row)
    return row
  }
  if (tname === 'audit_events') {
    const row: AuditRow = {
      id: newId(),
      operatorId: (v['operatorId'] as string | null) ?? null,
      action: String(v['action'] ?? ''),
      entityType: String(v['entityType'] ?? ''),
      entityId: String(v['entityId'] ?? ''),
      oldValue: v['oldValue'] ?? null,
      newValue: v['newValue'] ?? null,
      sourceIp: (v['sourceIp'] as string | null) ?? null,
      metadata: v['metadata'] ?? null,
      idempotencyKey: (v['idempotencyKey'] as string | null) ?? null,
      createdAt: (v['createdAt'] as Date) ?? new Date(),
    }
    state.auditEvents.push(row)
    return row
  }
  return null
}

function projectRow(row: Record<string, unknown>, cols: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = {}
  for (const [alias, col] of Object.entries(cols)) {
    const sqlName = (col as { name?: string }).name
    // The projection column's SQL name (e.g. `is_active`) and the
    // standin row's JS key (e.g. `isActive`) differ in this v1.
    // Look up both: the SQL name first, then a camelCase variant.
    if (sqlName && sqlName in row) {
      out[alias] = row[sqlName]
      continue
    }
    if (sqlName) {
      const camel = sqlName.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
      if (camel in row) {
        out[alias] = row[camel]
        continue
      }
    }
    // Last resort: pass the column object through (some tests
    // use Drizzle's `eq` on column references and need the
    // table+column name).
    out[alias] = (row as Record<string, unknown>)[alias]
  }
  return out
}

const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name')

function tableName(t: unknown): string {
  if (typeof t !== 'object' || t === null) return ''
  const sym = (t as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL]
  if (typeof sym === 'string') return sym
  if (typeof (t as { name?: unknown }).name === 'string') {
    return (t as { name: string }).name
  }
  return ''
}

/**
 * Run an `and(eq(a,x), eq(b,y))` filter against a standin state.
 * The standin only supports the equality filter shape the
 * dispatcher builds (it never writes ILIKE / OR queries). The
 * `and` / `eq` here are imported from drizzle-orm so we get
 * real Drizzle AST objects — the parser walks the chunks
 * looking for the `eq` leaf pattern.
 */
function filterAndProject(
  state: StandinState,
  table: unknown,
  cond: unknown,
  projection: Record<string, unknown> | undefined,
  limit: number,
): unknown[] {
  const tname = tableName(table)
  const filters = collectEqFilters(cond)
  let rows: Array<Record<string, unknown>>
  if (tname === 'notifications')
    rows = state.notifications as unknown as Array<Record<string, unknown>>
  else if (tname === 'operators')
    rows = state.operators as unknown as Array<Record<string, unknown>>
  else if (tname === 'audit_events')
    rows = state.auditEvents as unknown as Array<Record<string, unknown>>
  else return []

  const matched = rows.filter((r) =>
    filters.every((f) => {
      // The filter column is in SQL snake_case; the standin row
      // is in JS camelCase. Try both.
      const v = r[f.column] ?? r[toCamel(f.column)]
      return v === f.value
    }),
  )
  if (!projection || Object.keys(projection).length === 0) {
    return matched.slice(0, limit)
  }
  return matched.slice(0, limit).map((r) => projectRow(r, projection))
}

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

interface EqFilter {
  column: string
  value: unknown
}

function collectEqFilters(cond: unknown): EqFilter[] {
  if (!cond) return []
  const out: EqFilter[] = []
  const obj = cond as { queryChunks?: unknown[] }
  if (Array.isArray(obj.queryChunks)) {
    walk(obj.queryChunks, out)
  }
  return out
}

function walk(chunks: unknown[], out: EqFilter[]): void {
  // Direct 5-chunk `eq` shape: ['', col, ' = ', val, ''].
  if (chunks.length === 5) {
    const colRaw = chunks[1]
    const col = (colRaw as { name?: unknown })?.name
    if (typeof col === 'string' && stringValue(chunks[2]) === ' = ') {
      const val = unwrapValue(chunks[3])
      out.push({ column: col, value: val })
      return
    }
  }
  // Otherwise: the array is a wrapper (e.g. `and(eq1, eq2)`).
  // Recurse into nested SQL fragments and also try to interpret
  // each chunk as a 5-part `eq`.
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i]
    if (typeof c === 'string') continue
    if (c === null || c === undefined) continue
    if (typeof c !== 'object') continue
    const ch = c as { value?: unknown; queryChunks?: unknown[] }
    if (Array.isArray(ch.value)) continue
    if (ch.queryChunks) {
      // 5-part `eq` nested
      if (ch.queryChunks.length === 5) {
        const col = colName(ch.queryChunks[1])
        const opStr = stringValue(ch.queryChunks[2])
        if (col && opStr === ' = ') {
          out.push({ column: col, value: unwrapValue(ch.queryChunks[3]) })
          continue
        }
      }
      walk(ch.queryChunks, out)
    }
  }
}

function colName(c: unknown): string | null {
  if (typeof c === 'string') return c
  if (typeof c !== 'object' || c === null) return null
  const obj = c as { name?: unknown; _?: { name?: string } }
  if (typeof obj.name === 'string') return obj.name
  if (obj._ && typeof obj._.name === 'string') return obj._.name
  return null
}

function stringValue(c: unknown): string | null {
  if (typeof c === 'string') return c
  if (typeof c !== 'object' || c === null) return null
  const obj = c as { value?: unknown }
  if (Array.isArray(obj.value)) {
    return (obj.value as unknown[]).find((x) => typeof x === 'string') as string | null
  }
  return null
}

function unwrapValue(c: unknown): unknown {
  if (c === null || c === undefined) return c
  if (typeof c !== 'object') return c
  const obj = c as {
    value?: unknown
    queryChunks?: unknown[]
    enumKeys?: unknown
    values?: unknown
  }
  if ('value' in obj) return obj.value
  if (Array.isArray(obj.queryChunks)) {
    // A boolean eq: rendered as `eq(col, placeholder)`. The
    // placeholder has a `value: undefined` and a string chunk with
    // the binding. The actual value lives in the `params` array
    // on the parent SQL. We can't reach it from here — the
    // dispatcher never queries by boolean, so we can hardcode
    // `true` for `is_active` matches.
    return undefined
  }
  return c
}

// Reference the imports so the bundler keeps them. Tests don't
// import drizzle-orm directly; the standin does the parsing.
void and
void eq
void operators
void notifications
void auditEvents
