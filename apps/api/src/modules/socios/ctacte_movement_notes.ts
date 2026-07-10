import { createHash } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { operators, type CtacteMovementNote } from '@athlos/db/schema'
import { emitAudit } from '@athlos/audit'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as repo from './ctacte_movement_notes_repository.ts'

/**
 * `ctacte_movement_notes` service — business logic for the per-movement
 * notes attached to `tesoreria.ctacte` rows.
 *
 * PR A1a (athlos-ctacte-mutations). The service composes:
 *   1. The repository (Drizzle wrapper).
 *   2. A `public.operators` lookup to enrich each note with the
 *      author's username + role for the `OperatorChip` component
 *      (the chip renders `username · ROLE` in the UI).
 *   3. Durable audit emission via `@athlos/audit` using the same
 *      deterministic note identity as the insert.
 *
 * The route layer is thin: parse + auth → call into here → shape
 * response. No new routes are added in PR A1a (those land in A1b).
 *
 * Audit emission is best-effort relative to the primary write — a
 * failure here MUST NOT mask the original operation. The
 * `audit_events` table is append-only and a missed row is recoverable
 * from the operator's session log; the opposite (a 500 on a
 * successful note insert) would be the worse outcome.
 */

export interface CtacteNoteService {
  id: string
  body: string
  authorOperatorId: string
  authorUsername: string | null
  authorRole: string | null
  createdAt: Date
}

/**
 * Map a single-char role code to its human-readable label. Matches
 * the mapping in `packages/auth` so the chip displays the same
 * label the rest of the app does.
 */
function roleLabel(code: string): string | null {
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
      return null
  }
}

/**
 * List active notes for a movement, enriched with operator info for
 * the `OperatorChip`. Excludes soft-deleted notes (the repository
 * handles the WHERE).
 *
 * Returns `authorUsername: null` + `authorRole: null` for notes whose
 * author operator row is missing (e.g. the operator was hard-deleted
 * after the note was created). The UI fallback is "Operador
 * eliminado" per spec §"OperatorChip shows fallback when operator is
 * deleted".
 */
export async function listNotes(db: Db, movementId: string): Promise<CtacteNoteService[]> {
  const rows = await repo.listNotesByMovement(db, movementId)
  if (rows.length === 0) return []

  const operatorIds = Array.from(new Set(rows.map((r) => r.authorOperatorId)))
  const operatorRows = await db
    .select({ id: operators.id, username: operators.username, role: operators.role })
    .from(operators)
    .where(inArray(operators.id, operatorIds))
    .limit(Number.MAX_SAFE_INTEGER)

  const byId = new Map(operatorRows.map((o) => [o.id, o]))
  return rows.map((r) => {
    const op = byId.get(r.authorOperatorId)
    return {
      id: r.id,
      body: r.body,
      authorOperatorId: r.authorOperatorId,
      authorUsername: op?.username ?? null,
      authorRole: op ? roleLabel(op.role) : null,
      createdAt: r.createdAt,
    }
  })
}

export interface AddNoteInput {
  ctacteMovementId: string
  operatorId: string
  body: string
}

const retries = new WeakMap<object, Map<string, CtacteMovementNote>>()

/**
 * Add a note to a movement. Trims the body, inserts the row, and
 * emits a `CTACTE_MOVEMENT_NOTE_ADDED` audit event with the exact
 * 5-key metadata shape pinned by the audit-logger spec delta.
 *
 * The audit emission is best-effort — a failure here does NOT roll
 * back the insert. The audit metadata shape (sortable key order):
 *   - ctacte_id (string, the parent cuenta ID — same as movement_id
 *     because each ctacte row IS the cuenta for this domain; kept
 *     separate for future cuando ctacte agregue parent_id)
 *   - movement_id (string, the FK the note hangs off)
 *   - note_id (string)
 *   - body (string, full body — NOT a preview; the preview-only
 *     trim was a draft idea, the spec delta locked full body)
 *   - author_operator_id (string)
 */
export async function addNote(db: Db, input: AddNoteInput): Promise<CtacteMovementNote> {
  const body = input.body.trim()
  const retryKey = noteRetryKey(input.ctacteMovementId, input.operatorId, body)
  const cached = retries.get(db as object)?.get(retryKey)
  if (cached) return cached

  const inserted = await repo.insertNote(db, {
    ctacteMovementId: input.ctacteMovementId,
    authorOperatorId: input.operatorId,
    body,
    id: retryKey,
  })
  const byDb = retries.get(db as object) ?? new Map<string, CtacteMovementNote>()
  byDb.set(retryKey, inserted)
  retries.set(db as object, byDb)
  await emitNoteAddedAudit(db, inserted, input.operatorId)
  return inserted
}

function noteRetryKey(movementId: string, operatorId: string, body: string): string {
  const bucket = Math.floor(Date.now() / 10_000)
  const hash = createHash('sha256')
    .update(`note|${movementId}|${operatorId}|${body}|${bucket}`)
    .digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

export type CtacteNoteCallerRole = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'

export interface SoftDeleteNoteAuth {
  callerOperatorId: string
  callerRole: CtacteNoteCallerRole | string
}

/**
 * Pure helper: soft-delete permission gate. Mirrors the rule used
 * by `notes.ts` for the per-socio notes surface — only the original
 * author OR an ADMIN may delete. Exported so the route layer can
 * re-use the same rule for pre-checks (e.g. showing or hiding the
 * delete button in the UI).
 */
export function canDeleteCtacteNote(
  note: { authorOperatorId: string },
  auth: SoftDeleteNoteAuth,
): boolean {
  if (auth.callerRole === 'ADMIN') return true
  return note.authorOperatorId === auth.callerOperatorId
}

/**
 * Soft-delete a note. Sets `deleted_at = now()` and preserves the
 * `CTACTE_MOVEMENT_NOTE_ADDED` audit row as the historical record
 * (spec delta §"Audit event for soft-deleted note remains queryable").
 *
 * Authorization (R3): only the original author OR an ADMIN may delete.
 * Non-author non-ADMIN callers receive `INSUFFICIENT_PERMISSIONS`
 * (mapped to 403 by the global error handler). Unknown note ids
 * receive `NOT_FOUND` (mapped to 404).
 *
 * We intentionally do NOT emit a new audit event — the spec locks
 * the audit union to 4 ctacte actions (no `CTACTE_MOVEMENT_NOTE_DELETED`)
 * and the original ADD row is the authoritative history. A future
 * change can add a DELETED action and emit it here if product asks
 * for the explicit timeline event.
 */
export async function softDeleteNote(
  db: Db,
  noteId: string,
  auth: SoftDeleteNoteAuth,
): Promise<void> {
  const existing = await repo.findNoteById(db, noteId)
  if (!existing) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Note not found')
  }
  if (!canDeleteCtacteNote(existing, auth)) {
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Only the author or an ADMIN can delete this note',
    )
  }
  await repo.softDeleteNote(db, noteId)
}

/**
 * Best-effort audit emission for `CTACTE_MOVEMENT_NOTE_ADDED`.
 *
 * `emitAudit` persists the deduplication decision in the shared audit
 * table. Including the deterministic note ID and body in its payload
 * makes concurrent retries, restarts, and different API replicas emit
 * exactly one matching audit row while keeping different bodies distinct.
 */
async function emitNoteAddedAudit(
  db: Db,
  row: CtacteMovementNote,
  operatorId: string,
): Promise<void> {
  try {
    await emitAudit(db, {
      operatorId,
      action: 'CTACTE_MOVEMENT_NOTE_ADDED',
      entityType: 'ctacte_movement_note',
      entityId: row.id,
      oldValue: null,
      newValue: {
        id: row.id,
        ctacte_movement_id: row.ctacteMovementId,
        body: row.body,
        author_operator_id: row.authorOperatorId,
      },
      sourceIp: null,
      payload: {
        note_id: row.id,
        ctacte_movement_id: row.ctacteMovementId,
        body: row.body,
      },
      metadata: {
        ctacte_id: row.ctacteMovementId,
        movement_id: row.ctacteMovementId,
        note_id: row.id,
        body: row.body,
        author_operator_id: row.authorOperatorId,
      },
    })
  } catch (err) {
    // Surface for ops but do not propagate — the note is already in
    // the caller's hands and we MUST NOT roll back a successful insert.
    console.error('[ctacte-movement-notes] failed to emit CTACTE_MOVEMENT_NOTE_ADDED', err)
  }
}
