import { eq, type SQL } from 'drizzle-orm'
import type { NewRawEvent, RawEvent } from '@athlos/db/schema'
import { rawEvents } from '@athlos/db/schema'

/**
 * Minimal in-memory Drizzle standin for the @athlos/import tests.
 * Implements only the surface the import pipeline exercises:
 *
 *   - `db.insert(rawEvents).values(v).onConflictDoNothing(...).returning(...)`
 *   - `db.select({id}).from(rawEvents).where(eq(rawEvents.sourceTable, t)).limit(1)`
 *
 * The standin is one-purpose: the production pipeline targets PG
 * with real `ON CONFLICT DO NOTHING` + jsonb semantics, which the
 * apps/api standin does not model. The full SQL surface is exercised
 * in CI's Postgres service by the integration suite.
 *
 * Why not reuse `apps/api/src/test-standins/db.ts`:
 *   - That standin models the API's per-table services (operators,
 *     socios, ctacte, audit_events, ...). It has no `raw_events`
 *     awareness and no `jsonb` payload handling.
 *   - The import package is upstream of the API; pulling in a 1000+
 *     line standin for a 50-line surface is the wrong trade.
 *
 * The standin supports:
 *   - `eq` only (the pipeline's only WHERE).
 *   - `limit(n)` only.
 *   - `onConflictDoNothing` with a 3-tuple unique target.
 *   - `returning({ id })` only.
 *
 * Not supported (callers MUST NOT use):
 *   - `update`, `delete`, `transaction`, joins, `and`/`or`/`isNull`/etc.
 */

export interface ImportStandinState {
  rows: RawEvent[]
  /** TASK-065: entity_uuids for UUID lookup-or-create */
  entityUuids: Array<{
    sourceTable: string
    sourceKey: string
    entityUuid: string
    createdAt: Date
  }>
}

export interface ImportStandinDb {
  state: ImportStandinState
  reset(): void
}

function newId(): string {
  return (
    '00000000-0000-4000-8000-' +
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(12, '0')
  )
}

/**
 * Translate a SQL column name (snake_case, as `eq` produces) to
 * the JS row key (camelCase, as `RawEvent` is typed). The standin
 * stores rows in the camelCase shape; the SQL names are only
 * used at the query boundary.
 */
const SQL_TO_JS: Readonly<Record<string, keyof RawEvent>> = {
  id: 'id',
  source_table: 'sourceTable',
  source_key: 'sourceKey',
  content_hash: 'contentHash',
  payload: 'payload',
  import_batch: 'importBatch',
  imported_at: 'importedAt',
}

function sqlToJs(sqlCol: string): keyof RawEvent | null {
  return SQL_TO_JS[sqlCol] ?? null
}

function makeRawEvent(v: NewRawEvent): RawEvent {
  return {
    id: newId(),
    sourceTable: v.sourceTable,
    sourceKey: v.sourceKey,
    contentHash: v.contentHash,
    payload: v.payload,
    importBatch: v.importBatch,
    importedAt: v.importedAt ?? new Date(),
  }
}

const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name')

/**
 * Resolve the SQL table name from a Drizzle table object. Drizzle
 * 0.36 stores the name on `Symbol.for('drizzle:Name')`; older
 * builds also expose it on `._.name`. We probe both, plus the
 * plain `name` property for the rare case where the table is
 * already a plain object.
 */
function resolveTableName(t: unknown): string {
  if (typeof t !== 'object' || t === null) return ''
  const obj = t as { name?: unknown; _?: { name?: string } }
  const sym = (obj as unknown as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL]
  if (typeof sym === 'string') return sym
  if (typeof obj.name === 'string') return obj.name
  if (obj._ && typeof obj._.name === 'string') return obj._.name
  return ''
}

function columnName(col: unknown): string | null {
  if (typeof col === 'string') return col
  if (typeof col !== 'object' || col === null) return null
  const obj = col as { name?: unknown; _?: { name?: string } }
  if (typeof obj.name === 'string') return obj.name
  if (obj._ && typeof obj._.name === 'string') return obj._.name
  return null
}

function unwrapValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v
  const obj = v as { value?: unknown }
  if ('value' in obj) return obj.value
  return v
}

/**
 * Parse `eq(col, value)` into a `(sqlCol, value)` pair. The leaf shape
 * is 5 chunks: [undefined, col, ' = ', value, undefined].
 */
function parseEqLeaf(cond: unknown): { sqlCol: string; value: unknown } | null {
  if (!cond || typeof cond !== 'object') return null
  const obj = cond as { queryChunks?: Array<unknown> }
  if (!obj.queryChunks || obj.queryChunks.length !== 5) return null
  const col = columnName(obj.queryChunks[1])
  if (!col) return null
  const op = obj.queryChunks[2] as { value?: string[] } | undefined
  const opStr = op?.value?.[0]
  if (opStr !== ' = ') return null
  return { sqlCol: col, value: unwrapValue(obj.queryChunks[3]) }
}

export function createImportStandinDb(): ImportStandinDb & {
  drizzle: DrizzleShim
} {
  const state: ImportStandinState = { rows: [], entityUuids: [] }

  function applyConflictTarget(target: unknown): Array<keyof RawEvent> {
    if (Array.isArray(target)) {
      return target.map((t) => {
        const c = columnName(t)
        if (!c) throw new Error(`unknown conflict target column: ${String(t)}`)
        const j = sqlToJs(c)
        if (!j) throw new Error(`unknown conflict target column: ${c}`)
        return j
      })
    }
    const c = columnName(target)
    if (!c) throw new Error(`unknown conflict target column: ${String(target)}`)
    const j = sqlToJs(c)
    if (!j) throw new Error(`unknown conflict target column: ${c}`)
    return [j]
  }

  function isDup(state: ImportStandinState, v: NewRawEvent, cols: Array<keyof RawEvent>): boolean {
    return state.rows.some((r) => cols.every((c) => r[c] === v[c as keyof NewRawEvent]))
  }

  const drizzle: DrizzleShim = {
    select(_projection?: unknown) {
      return {
        from(_table: unknown) {
          function runAll(): Promise<RawEvent[]> {
            return Promise.resolve(state.rows.slice())
          }
          function runWhere(cond: unknown) {
            const eq = parseEqLeaf(cond)
            function runLimit(n: number): Promise<RawEvent[]> {
              let rows = state.rows
              if (eq) {
                const key = sqlToJs(eq.sqlCol)
                if (key) {
                  rows = rows.filter((r) => r[key] === eq.value)
                }
              }
              return Promise.resolve(rows.slice(0, n))
            }
            // `db.select().from().where()` is also a valid Drizzle
            // pattern (no .limit). The bridge-validator iterates
            // the rows directly when reading CONNROASIE. Make the
            // `where` chain awaitable.
            const whereChain = {
              limit: (n: number) => runLimit(n),
              then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
                runLimit(Number.MAX_SAFE_INTEGER).then(onFulfilled, onRejected),
            }
            return whereChain
          }
          // Make `.from()` thenable so the `await db.select().from()`
          // pattern (no .where()) used by the dependency check
          // resolves to the full row list.
          const fromChain = {
            where: (cond: unknown) => runWhere(cond),
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              runAll().then(onFulfilled, onRejected),
          }
          return fromChain
        },
      }
    },
    insert(table: unknown) {
      // Sanity: only raw_events is supported. Resolve the table
      // name from Drizzle's private `Symbol(drizzle:Name)` — the
      // apps/api standin uses the same lookup.
      const tname = resolveTableName(table)
      if (tname !== 'raw_events') {
        return {
          values(_v: unknown) {
            return {
              onConflictDoNothing(_opts: { target: unknown }) {
                return {
                  returning(_cols?: unknown): Promise<RawEvent[]> {
                    return Promise.reject(
                      new Error(`import standin: insert not supported for ${String(tname)}`),
                    )
                  },
                }
              },
            }
          },
        }
      }
      return {
        values(v: NewRawEvent) {
          return {
            onConflictDoNothing(opts: { target: unknown }) {
              const cols = applyConflictTarget(opts.target)
              return {
                returning(_cols?: unknown): Promise<RawEvent[]> {
                  if (isDup(state, v, cols)) return Promise.resolve([])
                  const row = makeRawEvent(v)
                  state.rows.push(row)
                  return Promise.resolve([row])
                },
              }
            },
          }
        },
      }
    },
  }

  return {
    state,
    reset() {
      state.rows.length = 0
    },
    drizzle,
  }
}

/**
 * Subset of the Drizzle client shape the pipeline uses. Exported so
 * test files can `as unknown as Db` to satisfy the type without
 * pulling in a 1000-line mock.
 */
export interface DrizzleShim {
  select(projection?: unknown): unknown
  insert(table: unknown): unknown
}

// Keep `eq` and `SQL` referenced so they don't tree-shake if a
// caller wants to compose conditions (we don't use them today but
// the standin signature accepts them).
void eq
void ({} as SQL)
void rawEvents
