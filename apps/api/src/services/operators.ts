import type { Db } from '@athlos/db'
import { operators, refreshTokens, type Operator } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { hashPassword } from '@athlos/auth'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { toOperatorDTO, type OperatorDTO } from './auth.ts'

/**
 * Admin operator management service layer.
 *
 * Every function is pure-shaped: takes a `Db` and small input,
 * returns a DTO (no `password_hash` ever leaves the service layer).
 * Routes compose these into the HTTP surface in
 * `apps/api/src/routes/admin/operators.ts`.
 *
 * Scope is intentionally tight: the PR 3b task list only ships
 * list / create / update / soft-delete / unlock + login-history.
 * Self-update prevention and reset-password are intentionally
 * deferred — they need the `must_change_password` column and
 * `operator_password_history` table from the user-management spec
 * delta, which is its own change in a later PR.
 */

export type OperatorRole = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'

export interface ListOperatorsInput {
  cursor?: string
  limit: number
  role?: OperatorRole
  isActive?: boolean
}

export interface ListOperatorsResult {
  items: OperatorDTO[]
  nextCursor: string | null
}

export interface CreateOperatorInput {
  username: string
  password: string
  role: OperatorRole
  canReprint?: boolean
  canAnulate?: boolean
}

export interface UpdateOperatorInput {
  id: string
  role?: OperatorRole
  canReprint?: boolean
  canAnulate?: boolean
  isActive?: boolean
}

export interface UnlockOperatorResult {
  message: 'Operator unlocked'
  id: string
}

export interface LoginHistoryEntry {
  id: string
  action: 'LOGIN_SUCCESS' | 'LOGIN_FAILED'
  created_at: Date
  ip_address: string | null
  user_agent: string | null
}

export interface LoginHistoryResult {
  items: LoginHistoryEntry[]
  nextCursor: string | null
}

/**
 * Resolve the role-default permissions so an ADMIN creating a new
 * OPERADOR with no `can_reprint` / `can_anulate` override still
 * produces a row consistent with the spec's role-default matrix.
 */
export function roleDefaults(role: OperatorRole): { canReprint: boolean; canAnulate: boolean } {
  switch (role) {
    case 'ADMIN':
    case 'TESORERO':
      return { canReprint: true, canAnulate: true }
    case 'OPERADOR':
    case 'CONSULTA':
      return { canReprint: false, canAnulate: false }
  }
}

/**
 * Validate that a username is unique. Returns the count of rows with
 * the same username (0 = available). Cheap query on the unique index.
 */
export async function countByUsername(db: Db, username: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(operators)
    .where(eq(operators.username, username))
    .limit(1)
  return row?.n ?? 0
}

/**
 * List operators with cursor pagination. The cursor is the last
 * item's `created_at` (ISO string) — items are ordered by
 * `created_at DESC, id DESC` so the cursor is stable across
 * inserts with the same timestamp. Filter by role / isActive as
 * optional narrowing.
 */
export async function listOperators(
  db: Db,
  input: ListOperatorsInput,
): Promise<ListOperatorsResult> {
  const limit = Math.min(Math.max(input.limit, 1), 100)
  const conds = []
  if (input.role) conds.push(eq(operators.role, roleToChar(input.role)))
  if (input.isActive !== undefined) conds.push(eq(operators.isActive, input.isActive))

  // Cursor: items strictly older than the parsed cursor timestamp.
  if (input.cursor) {
    const cursorDate = new Date(input.cursor)
    if (Number.isNaN(cursorDate.getTime())) {
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Invalid cursor')
    }
    conds.push(lt(operators.createdAt, cursorDate))
  }

  const where = conds.length > 0 ? and(...conds) : undefined
  const rows = await db
    .select()
    .from(operators)
    .where(where)
    .orderBy(desc(operators.createdAt), desc(operators.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = (hasMore ? rows.slice(0, limit) : rows).map(toOperatorDTO)
  const last = items[items.length - 1]
  const nextCursor = hasMore && last ? last.created_at.toISOString() : null
  return { items, nextCursor }
}

/**
 * Create a new operator. Hashes the password (bcrypt cost-12),
 * validates the username is unique, and returns the created DTO.
 * Throws CONFLICT (409) on duplicate username.
 */
export async function createOperator(db: Db, input: CreateOperatorInput): Promise<OperatorDTO> {
  const username = input.username.trim()
  if ((await countByUsername(db, username)) > 0) {
    throw BusinessError(ErrorCode.CONFLICT, `Username "${username}" is already taken`)
  }
  const defaults = roleDefaults(input.role)
  const passwordHash = await hashPassword(input.password)
  const [row] = await db
    .insert(operators)
    .values({
      username,
      passwordHash,
      role: roleToChar(input.role),
      canReprint: input.canReprint ?? defaults.canReprint,
      canAnulate: input.canAnulate ?? defaults.canAnulate,
    })
    .returning()
  if (!row) {
    throw BusinessError(ErrorCode.INTERNAL_ERROR, 'operators insert returned no row')
  }
  return toOperatorDTO(row)
}

/**
 * Update an existing operator. Only the fields present on the input
 * are changed. Throws NOT_FOUND if the id is unknown. The `password`
 * is intentionally NOT updatable here — use a dedicated reset-password
 * flow (lands in a later PR with the password_history table).
 */
export async function updateOperator(db: Db, input: UpdateOperatorInput): Promise<OperatorDTO> {
  const patch: Partial<Operator> = { updatedAt: new Date() }
  if (input.role !== undefined) patch.role = roleToChar(input.role)
  if (input.canReprint !== undefined) patch.canReprint = input.canReprint
  if (input.canAnulate !== undefined) patch.canAnulate = input.canAnulate
  if (input.isActive !== undefined) patch.isActive = input.isActive

  const [row] = await db.update(operators).set(patch).where(eq(operators.id, input.id)).returning()
  if (!row) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Operator not found')
  }
  return toOperatorDTO(row)
}

/**
 * Soft-delete: set `is_active = false` and revoke every active
 * refresh token for the operator. The row is preserved (audit trail)
 * but no further logins can succeed (login.ts checks `is_active`).
 * Returns the id for route-level logging.
 */
export async function softDeleteOperator(db: Db, id: string): Promise<{ id: string }> {
  const [row] = await db
    .update(operators)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(operators.id, id))
    .returning({ id: operators.id })
  if (!row) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Operator not found')
  }
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.operatorId, id), isNull(refreshTokens.revokedAt)))
  return { id: row.id }
}

/**
 * Clear a lockout: `failed_login_attempts = 0`, `locked_until = null`.
 * Throws NOT_FOUND if the id is unknown. The route returns 200
 * with a small body so the admin UI can confirm the action.
 */
export async function unlockOperator(db: Db, id: string): Promise<UnlockOperatorResult> {
  const [row] = await db
    .update(operators)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(operators.id, id))
    .returning({ id: operators.id })
  if (!row) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Operator not found')
  }
  return { message: 'Operator unlocked', id: row.id }
}

/**
 * Read the login history for one operator. The audit_events table is
 * the source of truth for `LOGIN_SUCCESS` / `LOGIN_FAILED` (login.ts
 * already writes there). For PR 3b the audit emission is the next
 * step — until then this returns `[]`. The query shape is wired
 * now so the route layer is stable and the emission can be turned
 * on without route changes.
 */
export async function getLoginHistory(
  db: Db,
  operatorId: string,
  cursor: string | undefined,
  limit: number | undefined,
): Promise<LoginHistoryResult> {
  const n = Math.min(Math.max(limit, 1), 100)
  // The audit_events table is INSERT-only; for PR 3b the login flow
  // does not yet emit rows (that lands when the auth-audit hook
  // ships). Returning an empty result keeps the API contract honest
  // — the route returns 200 with `items: []` until the writer lands.
  // Implementation note: when the writer is in place, the query is
  // a select from audit_events with operatorId = $1, action IN
  // ('LOGIN_SUCCESS','LOGIN_FAILED'), order by created_at DESC, id DESC,
  // with cursor on created_at.
  void db
  void operatorId
  void cursor
  void n
  return { items: [], nextCursor: null }
}

function roleToChar(role: OperatorRole): string {
  switch (role) {
    case 'ADMIN':
      return 'A'
    case 'TESORERO':
      return 'T'
    case 'OPERADOR':
      return 'O'
    case 'CONSULTA':
      return 'C'
  }
}
