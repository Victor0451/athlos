import { z } from 'zod'
import { inArray } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { operators } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'

/**
 * `operator-lookup` module — read-only batch resolution of operator
 * summaries for the AuditTab and SocioNotesCard render surfaces.
 *
 * The single schema lives here (rather than a sibling `schema.ts`)
 * per design D3: the file is tiny and used by exactly one consumer
 * (the `/api/v1/operators` route). If a second module consumer
 * appears, split into `schema.ts`.
 *
 * No `is_active` is exposed on the wire DTO — soft-deleted operators
 * are returned with their historical name (design R3, §UI note).
 * Widening the DTO requires a spec amendment, not a code change.
 */

/** Operator roles as carried on the wire. Mirrors `services/auth.ts`. */
export const OperatorRole = z.enum(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA'])

export type OperatorRole = z.infer<typeof OperatorRole>

/**
 * Wire DTO for a single row returned by the batch lookup. Only these
 * three columns leave Postgres (design D5) — `password_hash`,
 * `failed_login_attempts`, `is_active`, etc. stay server-side.
 */
export interface OperatorSummary {
  id: string
  username: string
  role: OperatorRole
}

/**
 * Validation schema for `GET /api/v1/operators?ids=…`.
 *
 * - `ids`: non-empty array of UUID strings, max 200 entries.
 *   The 200-cap (spec §"Input validation") protects against URL-length
 *   abuse — 200 UUIDs × 36 chars = ~7.2 KB well under the 8 KB Fastify
 *   default header cap.
 *
 * Violations throw a ZodError at parse time; the route layer wraps
 * the parse with `throwIfInvalid` from `@athlos/errors`, which the
 * global error handler turns into a 400 `VALIDATION_ERROR`.
 */
export const getOperatorByIdsQuerySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
})

/**
 * Decode the `operators.role` char(1) column to the wire enum.
 * Mirrors `apps/api/src/services/auth.ts:charToRole` — kept private
 * here (design D6) rather than re-exporting from auth to avoid
 * coupling two packages for 6 lines.
 */
function charToRole(code: string): OperatorRole {
  switch (code) {
    case 'A':
      return 'ADMIN'
    case 'T':
      return 'TESORERO'
    case 'O':
      return 'OPERADOR'
    case 'C':
      return 'CONSULTA'
    default:
      throw BusinessError(ErrorCode.INTERNAL_ERROR, `Unknown operator role code: ${code}`)
  }
}

/**
 * Resolve a batch of operator ids to their public summaries.
 *
 * One Drizzle query (`inArray(operators.id, ids)`) — never per-id
 * roundtrips (spec §"Single batched query"). The SELECT projection
 * is intentionally narrow: only `id`, `username`, `role` leave the
 * database (design D5), so `password_hash`, `failed_login_attempts`,
 * and `is_active` never reach this code path.
 *
 * Missing ids are silently omitted (spec §"Mixed valid + unknown").
 * Soft-deleted rows (`is_active = false`) are returned with their
 * historical name (spec §"Soft-deleted operators retained") — the
 * chip helper treats active and soft-deleted rows identically
 * because the wire DTO doesn't expose `is_active`.
 *
 * Empty input short-circuits to `[]` so the route layer doesn't
 * waste a roundtrip on a query that's guaranteed to return nothing.
 */
export async function listByIds(db: Db, ids: string[]): Promise<OperatorSummary[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: operators.id,
      username: operators.username,
      role: operators.role,
    })
    .from(operators)
    .where(inArray(operators.id, ids))
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    role: charToRole(row.role),
  }))
}
