import { z } from 'zod'

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
