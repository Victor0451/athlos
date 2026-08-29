import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { ErrorCode } from '@athlos/errors'
import type { ApiError } from '@athlos/errors'
import {
  createCondonationApprovalRequest,
  decideCondonationApproval,
  consumeApprovalToken,
  createApprovalToken,
  getApprovalToken,
} from './service.ts'
import { generateApprovalToken, hashApprovalToken } from './token.ts'
import type { ApprovalToken } from '@athlos/db/schema'

/**
 * Minimal in-memory Drizzle stand-in. Implements only the surface the
 * approval service uses: insert/returning, select/where/limit, and
 * update/where/returning. The expressions used in the service are:
 *
 *   - `eq(table.col, value)`     → string equality
 *   - `isNull(table.col)`        → null check
 *   - `gt(table.col, value)`     → greater-than (used with Date)
 *   - `and(...)`                 → boolean AND
 *
 * The stand-in is deliberately tiny — production code never imports
 * it. It exists so the approval tests can run with `vitest run` and no
 * Postgres dependency. PR 7's integration tests will cover the real
 * SQL.
 */
type Row = ApprovalToken

interface StandinDb {
  rows: Row[]
  insertReturning(values: Partial<Row>): Row
  selectWhere(filters: Filter[]): Row[]
  updateWhere(filters: Filter[], patch: Partial<Row>): Row[]
}

type Filter = { kind: 'eq' | 'isNull' | 'gt'; column: keyof Row; value: unknown }

/**
 * Map a SQL column name (snake_case, as Drizzle emits) to the
 * camelCase key on the in-memory row. The stand-in stores rows in the
 * camelCase shape produced by `$inferSelect` so the Drizzle-side column
 * reference and the JS-side row key differ in case style.
 */
const SQL_TO_JS: Record<string, keyof Row> = {
  id: 'id',
  token_hash: 'tokenHash',
  action_type: 'actionType',
  action_id: 'actionId',
  context_summary: 'contextSummary',
  created_by_operator_id: 'createdByOperatorId',
  approver_channel: 'approverChannel',
  approver_address: 'approverAddress',
  expires_at: 'expiresAt',
  used_at: 'usedAt',
  status: 'status',
  condonation_snapshot: 'condonationSnapshot',
  request_reason: 'requestReason',
  request_evidence: 'requestEvidence',
  decided_by_operator_id: 'decidedByOperatorId',
  decision_reason: 'decisionReason',
  decision_evidence: 'decisionEvidence',
  decided_at: 'decidedAt',
  execution_id: 'executionId',
  caller_key: 'callerKey',
  request_fingerprint: 'requestFingerprint',
  created_at: 'createdAt',
}

function jsColumn(sqlName: string): keyof Row | null {
  return SQL_TO_JS[sqlName] ?? null
}

function createStandinDb(): StandinDb {
  const rows: Row[] = []
  const matches = (row: Row, f: Filter): boolean => {
    const jsCol = jsColumn(f.column)
    if (!jsCol) return false
    const v = row[jsCol]
    if (f.kind === 'eq') return v === f.value
    if (f.kind === 'isNull') return v === null || v === undefined
    if (f.kind === 'gt') return (v as Date) > (f.value as Date)
    return false
  }
  return {
    rows,
    insertReturning(values) {
      const row = {
        id: values.id ?? cryptoRandomId(),
        tokenHash: values.tokenHash!,
        actionType: values.actionType!,
        actionId: values.actionId!,
        contextSummary: values.contextSummary!,
        createdByOperatorId: values.createdByOperatorId!,
        approverChannel: values.approverChannel!,
        approverAddress: values.approverAddress!,
        expiresAt: values.expiresAt!,
        usedAt: values.usedAt ?? null,
        status: (values.status ?? 'pending') as Row['status'],
        condonationSnapshot: values.condonationSnapshot ?? null,
        requestReason: values.requestReason ?? null,
        requestEvidence: values.requestEvidence ?? null,
        decidedByOperatorId: values.decidedByOperatorId ?? null,
        decisionReason: values.decisionReason ?? null,
        decisionEvidence: values.decisionEvidence ?? null,
        decidedAt: values.decidedAt ?? null,
        executionId: values.executionId ?? null,
        callerKey: values.callerKey ?? null,
        requestFingerprint: values.requestFingerprint ?? null,
        createdAt: values.createdAt ?? new Date(),
      }
      rows.push(row)
      return row
    },
    selectWhere(filters) {
      return rows.filter((r) => filters.every((f) => matches(r, f)))
    },
    updateWhere(filters, patch) {
      const updated: Row[] = []
      for (const r of rows) {
        if (filters.every((f) => matches(r, f))) {
          Object.assign(r, patch)
          updated.push(r)
        }
      }
      return updated
    },
  }
}

function cryptoRandomId(): string {
  // Cheap random uuid-shape for the stand-in; not RFC 4122.
  return createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 36)
}

/**
 * Wrap the stand-in as a Drizzle-shaped object the service can call.
 * The service only uses a subset of the query builder, so the wrapper
 * returns `undefined`/empty arrays on the parts we don't implement —
 * enough to keep `result[0]` undefined paths covered.
 */
function asDrizzle(standin: StandinDb): Parameters<typeof createApprovalToken>[0] {
  return {
    insert: (_table: { _: { name: string } }) => ({
      values: (v: Partial<Row>) => ({
        returning: () => [standin.insertReturning(v)],
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: (n: number) => {
            const filters = normalizeFilters(cond)
            const hits = standin.selectWhere(filters).slice(0, n)
            return Promise.resolve(hits)
          },
        }),
      }),
    }),
    update: (_table: { _: { name: string } }) => ({
      set: (patch: Partial<Row>) => ({
        where: (cond: unknown) => ({
          returning: () => standin.updateWhere(normalizeFilters(cond), patch),
        }),
      }),
    }),
  } as unknown as Parameters<typeof createApprovalToken>[0]
}

function normalizeFilters(cond: unknown): Filter[] {
  if (!cond) return []
  if (Array.isArray(cond)) return cond.flatMap(normalizeFilters)
  const obj = cond as { queryChunks?: Array<unknown> }
  if (obj.queryChunks) {
    return parseChunks(obj.queryChunks)
  }
  return []
}

/**
 * Walk a flat list of Drizzle `queryChunks` and pull out every
 * column/operator/value triple. Each chunk is one of:
 *
 *   - `{ value: ['...'] }`     — a literal SQL fragment (skip)
 *   - `string`                 — a column name or literal (skip)
 *   - `{ queryChunks: [...] }` — a nested node; recurse
 *
 * The leaves (`eq`, `isNull`, `gt`) have a 4-or-5-chunk shape that we
 * recognise and turn into {@link Filter} entries.
 */
function parseChunks(chunks: Array<unknown>): Filter[] {
  const out: Filter[] = []
  for (const chunk of chunks) {
    if (chunk === null || chunk === undefined) continue
    if (typeof chunk === 'string') continue
    if (typeof chunk !== 'object') continue
    const inner = chunk as { value?: unknown; queryChunks?: Array<unknown> }
    if (Array.isArray(inner.value)) continue
    if (inner.queryChunks) {
      // Try the leaf shape first; if it doesn't match, recurse.
      const leaf = parseLeaf(inner.queryChunks)
      if (leaf) {
        out.push(leaf)
      } else {
        out.push(...parseChunks(inner.queryChunks))
      }
    }
  }
  return out
}

/**
 * Extract the column name from a Drizzle column reference. Each
 * `pgTable` column is a `PgColumn` object whose `name` is the SQL
 * identifier; older versions used `_`.name and 0.36.x uses the bare
 * `name`. We try both.
 */
function columnName(col: unknown): string | null {
  if (typeof col === 'string') return col
  if (typeof col !== 'object' || col === null) return null
  const obj = col as { name?: unknown; _: { name: string } }
  if (typeof obj.name === 'string') return obj.name
  if (obj._ && typeof obj._.name === 'string') return obj._.name
  return null
}

/**
 * Extract the raw value from a chunk that may be a Drizzle `Param`
 * wrapper, a string, a Date, or some other primitive. Drizzle wraps
 * every non-literal value in `Param` so the SQL builder can bind it
 * to a placeholder — for our stand-in we just need the value back.
 */
function unwrapValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v
  const obj = v as { value?: unknown }
  if ('value' in obj) return obj.value
  return v
}

/**
 * Inspect a single leaf's chunks and return a Filter, or null if the
 * shape doesn't match eq/isNull/gt.
 *
 * Observed shapes (Drizzle 0.36):
 *   eq(col, val)    → [VAL, COL, VAL, VAL, VAL]    (length 5)
 *   isNull(col)     → [VAL, COL, VAL]              (length 3, no value)
 *   gt(col, val)    → [VAL, COL, VAL, VAL, VAL]    (length 5)
 */
function parseLeaf(chunks: Array<unknown>): Filter | null {
  if (chunks.length === 3) {
    // isNull: column at index 1, operator at index 2.
    const col = columnName(chunks[1])
    const op = chunks[2] as { value?: string[] } | string | undefined
    const opStr = typeof op === 'object' && op && Array.isArray(op.value) ? op.value[0] : undefined
    if (col && opStr === ' is null') {
      return { kind: 'isNull', column: col as keyof Row, value: undefined }
    }
  }
  if (chunks.length === 5) {
    const col = columnName(chunks[1])
    const op = chunks[2] as { value?: string[] } | string | undefined
    const val = unwrapValue(chunks[3])
    const opStr = typeof op === 'object' && op && Array.isArray(op.value) ? op.value[0] : undefined
    if (col) {
      if (opStr === ' = ') {
        return { kind: 'eq', column: col as keyof Row, value: val }
      }
      if (opStr === ' > ') {
        return { kind: 'gt', column: col as keyof Row, value: val }
      }
    }
  }
  return null
}

describe('token crypto', () => {
  it('generates a 64-char hex raw and a 64-char hex sha256 hash', () => {
    const { raw, hash } = generateApprovalToken()
    expect(raw).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('two consecutive calls produce different raw values', () => {
    const a = generateApprovalToken()
    const b = generateApprovalToken()
    expect(a.raw).not.toBe(b.raw)
    expect(a.hash).not.toBe(b.hash)
  })

  it('hashApprovalToken is sha256 of the raw value', () => {
    const raw = '0123456789abcdef'.repeat(4)
    const expected = createHash('sha256').update(raw).digest('hex')
    expect(hashApprovalToken(raw)).toBe(expected)
  })
})

describe('createApprovalToken', () => {
  it('persists the hash and returns the raw only once', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const { raw, expiresAt, record } = await createApprovalToken(db, {
      actionType: 'ctacte.anulate',
      actionId: 'ctacte-1',
      contextSummary: 'Refund 100',
      operatorId: 'op-1',
      approverChannel: 'whatsapp',
      approverAddress: '+5491100000000',
    })
    expect(raw).toMatch(/^[0-9a-f]{64}$/)
    expect(standin.rows).toHaveLength(1)
    expect(standin.rows[0]?.tokenHash).toBe(hashApprovalToken(raw))
    expect(standin.rows[0]?.tokenHash).not.toBe(raw)
    expect(record.id).toBeDefined()
    expect(record.expiresAt).toEqual(expiresAt)
  })
})

describe('getApprovalToken', () => {
  it('returns the row when the raw token is valid', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const { raw } = await createApprovalToken(db, {
      actionType: 'a',
      actionId: 'b',
      contextSummary: 'c',
      operatorId: 'op-1',
      approverChannel: 'email',
      approverAddress: 'a@b.c',
    })
    const row = await getApprovalToken(db, raw)
    expect(row.tokenHash).toBe(hashApprovalToken(raw))
  })

  it('throws NOT_FOUND for an unknown token', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    try {
      await getApprovalToken(db, '0123456789abcdef'.repeat(4))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as ApiError).code).toBe(ErrorCode.NOT_FOUND)
    }
  })

  it('throws APPROVAL_LINK_EXPIRED for an expired token', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const { raw } = await createApprovalToken(db, {
      actionType: 'a',
      actionId: 'b',
      contextSummary: 'c',
      operatorId: 'op-1',
      approverChannel: 'email',
      approverAddress: 'a@b.c',
    })
    // Backdate the row to simulate expiry
    const row = standin.rows[0]
    if (row) row.expiresAt = new Date(Date.now() - 1000)
    try {
      await getApprovalToken(db, raw)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as ApiError).code).toBe(ErrorCode.APPROVAL_LINK_EXPIRED)
    }
  })

  it('throws APPROVAL_ALREADY_USED for a consumed token', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const { raw } = await createApprovalToken(db, {
      actionType: 'a',
      actionId: 'b',
      contextSummary: 'c',
      operatorId: 'op-1',
      approverChannel: 'email',
      approverAddress: 'a@b.c',
    })
    await consumeApprovalToken(db, raw)
    try {
      await getApprovalToken(db, raw)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as ApiError).code).toBe(ErrorCode.APPROVAL_ALREADY_USED)
    }
  })
})

describe('consumeApprovalToken', () => {
  it('marks the token used on first consume and fails the second', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const { raw } = await createApprovalToken(db, {
      actionType: 'a',
      actionId: 'b',
      contextSummary: 'c',
      operatorId: 'op-1',
      approverChannel: 'whatsapp',
      approverAddress: '+5491100000000',
    })
    const first = await consumeApprovalToken(db, raw)
    expect(first.usedAt).toBeInstanceOf(Date)
    expect(first.status).toBe('approved')
    try {
      await consumeApprovalToken(db, raw)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as ApiError).code).toBe(ErrorCode.APPROVAL_ALREADY_USED)
    }
  })
})

describe('condonation approval lifecycle', () => {
  const snapshot = {
    memberId: 'member-1',
    obligations: [{ obligationId: 'obligation-1', currency: 'ARS', outstandingAmountCents: 12500 }],
  }

  it('persists the immutable request snapshot, reason, and evidence', async () => {
    const standin = createStandinDb()
    const result = await createCondonationApprovalRequest(asDrizzle(standin), {
      requestId: 'request-1',
      contextSummary: 'Condone January membership fee',
      requesterId: 'operator-1',
      approverChannel: 'email',
      approverAddress: 'treasury@example.test',
      snapshot,
      reason: 'Documented hardship',
      evidence: 'case-123',
      callerKey: 'condonation-request-1',
    })

    expect(result.record).toMatchObject({
      actionType: 'dues.condonation',
      actionId: 'request-1',
      condonationSnapshot: snapshot,
      requestReason: 'Documented hardship',
      requestEvidence: 'case-123',
      status: 'pending',
      usedAt: null,
      executionId: null,
    })
  })

  it('replays an identical condonation request without creating another token', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const request = {
      requestId: 'request-1',
      contextSummary: 'Condone January membership fee',
      requesterId: 'operator-1',
      approverChannel: 'email' as const,
      approverAddress: 'treasury@example.test',
      snapshot,
      reason: 'Documented hardship',
      evidence: 'case-123',
      callerKey: 'condonation-request-1',
    }

    const first = await createCondonationApprovalRequest(db, request)
    const replay = await createCondonationApprovalRequest(db, request)

    expect(replay.record).toEqual(first.record)
    expect(standin.rows).toHaveLength(1)
  })

  it('records one approved decision without consuming or executing the request', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    await createCondonationApprovalRequest(db, {
      requestId: 'request-1',
      contextSummary: 'Condone January membership fee',
      requesterId: 'operator-1',
      approverChannel: 'email',
      approverAddress: 'treasury@example.test',
      snapshot,
      reason: 'Documented hardship',
      evidence: 'case-123',
      callerKey: 'condonation-request-1',
    })

    const result = await decideCondonationApproval(db, {
      requestId: 'request-1',
      actorId: 'treasurer-1',
      decision: 'approved',
      reason: 'Evidence accepted',
      evidence: 'treasury-note-9',
    })

    expect(result).toMatchObject({
      status: 'approved',
      decidedByOperatorId: 'treasurer-1',
      decisionReason: 'Evidence accepted',
      decisionEvidence: 'treasury-note-9',
      usedAt: null,
    })
    expect(result.decidedAt).toBeInstanceOf(Date)
    expect(result.executionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects self-decision and conflicting replay while returning an exact replay', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    await createCondonationApprovalRequest(db, {
      requestId: 'request-1',
      contextSummary: 'Condone January membership fee',
      requesterId: 'operator-1',
      approverChannel: 'email',
      approverAddress: 'treasury@example.test',
      snapshot,
      reason: 'Documented hardship',
      evidence: 'case-123',
      callerKey: 'condonation-request-1',
    })

    await expect(
      decideCondonationApproval(db, {
        requestId: 'request-1',
        actorId: 'operator-1',
        decision: 'rejected',
        reason: 'No',
        evidence: 'x',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })

    const input = {
      requestId: 'request-1',
      actorId: 'treasurer-1',
      decision: 'rejected' as const,
      reason: 'Insufficient evidence',
      evidence: 'treasury-note-9',
    }
    const first = await decideCondonationApproval(db, input)
    await expect(decideCondonationApproval(db, input)).resolves.toEqual(first)
    await expect(
      decideCondonationApproval(db, { ...input, decision: 'approved' }),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    })
  })
})
