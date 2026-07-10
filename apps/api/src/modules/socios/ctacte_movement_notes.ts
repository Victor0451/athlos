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
 *
 * R3 fix #2 — durable idempotency: `addNote` accepts a caller-
 * provided `idempotencyKey`. Replays (same key + same canonical
 * payload) return the previously-persisted row WITHOUT a second
 * audit emission. The previous 10-second SHA-256 timestamp-bucket
 * fallback has been removed because it did not survive process
 * restarts or cross-instance routing.
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
  /** Caller-supplied opaque Idempotency-Key (R3 fix #2). When
   *  present, retries with the same key + same payload return the
   *  previously-persisted note without a second audit emission.
   *  Reuse with a different payload returns `CONFLICT`. */
  idempotencyKey?: string
}

/**
 * Add a note to a movement.
 *
 *  1. Trims the body.
 *  2. When `idempotencyKey` is provided: looks up the existing row via
 *     the durable UNIQUE partial index.
 *     - Existing row + matching canonical payload → REPLAY (return the
 *       persisted row, do NOT emit a second audit event).
 *     - Existing row + different canonical payload → CONFLICT (the
 *       caller reused the key for a different intent).
 *  3. Otherwise (or no existing row): insert the note with the
 *     idempotency key, emit `CTACTE_MOVEMENT_NOTE_ADDED`, return the
 *     row.
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
 *
 * R3 fix #1: `expectedMovementId` is consulted AFTER finding the
 * existing note — if the row's `ctacteMovementId` does not match the
 * expectation, the replay is treated as a fresh insert with the same
 * idempotency key on a different movement (handled implicitly by the
 * non-existing-key lookup path).
 */
export async function addNote(db: Db, input: AddNoteInput): Promise<CtacteMovementNote> {
  const body = input.body.trim()
  const idempotencyKey = input.idempotencyKey

  if (idempotencyKey) {
    const existing = await repo.findNoteByIdempotencyKey(db, idempotencyKey)
    if (existing) {
      // Same note shape (movement + body) → REPLAY, no audit re-emission.
      if (existing.ctacteMovementId === input.ctacteMovementId && existing.body === body) {
        return existing
      }
      // Different movement OR different body with the same key → CONFLICT.
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency-Key was already used for a different note',
      )
    }
  }

  const inserted = await repo.insertNote(db, {
    ctacteMovementId: input.ctacteMovementId,
    authorOperatorId: input.operatorId,
    body,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  })
  await emitNoteAddedAudit(db, inserted, input.operatorId)
  return inserted
}

export type CtacteNoteCallerRole = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'

export interface SoftDeleteNoteAuth {
  callerOperatorId: string
  callerRole: CtacteNoteCallerRole | string
  /**
   * R3 fix #1 — the URL `movementId` MUST match the persisted note's
   * `ctacteMovementId`. A note belonging to a different movement
   * (even of the same socio) is treated as a 404 with no delete.
   */
  expectedMovementId: string
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
 * Authorization (R3):
 *   - R3 fix #1 — movement binding: the note MUST belong to the
 *     `expectedMovementId` passed in `auth`. A mismatch returns
 *     `NOT_FOUND` (mapped to 404) with no soft-delete side effect.
 *   - Author-or-ADMIN rule: only the original author OR an ADMIN may
 *     delete. Non-author non-ADMIN callers receive
 *     `INSUFFICIENT_PERMISSIONS` (mapped to 403). Unknown note ids
 *     receive `NOT_FOUND` (mapped to 404).
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
  // R3 fix #1 — nested resource binding. A note that does not belong
  // to the URL movement returns 404 with no delete side effect,
  // regardless of caller authorization.
  if (existing.ctacteMovementId !== auth.expectedMovementId) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Note does not belong to the requested movement')
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
