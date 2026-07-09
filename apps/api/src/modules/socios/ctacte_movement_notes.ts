import { inArray } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { auditEvents, operators, type CtacteMovementNote } from '@athlos/db/schema'
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
 *   3. Best-effort audit emission via `audit_events` (the DB-direct
 *      path; the @athlos/audit `emitAudit` wrapper is reserved for
 *      routes that want the SHA-256 10s idempotency bucket — the
 *      notes path matches the existing `socios/notes.ts` pattern
 *      which writes directly to `audit_events`).
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
  const inserted = await repo.insertNote(db, {
    ctacteMovementId: input.ctacteMovementId,
    authorOperatorId: input.operatorId,
    body: input.body.trim(),
  })
  await emitNoteAddedAudit(db, inserted, input.operatorId)
  return inserted
}

/**
 * Soft-delete a note. Sets `deleted_at = now()` and preserves the
 * `CTACTE_MOVEMENT_NOTE_ADDED` audit row as the historical record
 * (spec delta §"Audit event for soft-deleted note remains queryable").
 *
 * We intentionally do NOT emit a new audit event — the spec locks
 * the audit union to 4 ctacte actions (no `CTACTE_MOVEMENT_NOTE_DELETED`)
 * and the original ADD row is the authoritative history. A future
 * change can add a DELETED action and emit it here if product asks
 * for the explicit timeline event.
 */
export async function softDeleteNote(db: Db, noteId: string, _operatorId: string): Promise<void> {
  await repo.softDeleteNote(db, noteId)
}

/**
 * Best-effort audit emission for `CTACTE_MOVEMENT_NOTE_ADDED`.
 *
 * Mirrors the pattern in `socios/notes.ts` (DB-direct insert). The
 * `emitAudit` wrapper in @athlos/audit is reserved for routes that
 * benefit from the SHA-256 10s bucket dedupe — note writes are not
 * idempotent targets (different bodies must produce distinct rows)
 * so the dedup wrapper would only confuse the audit trail here.
 */
async function emitNoteAddedAudit(
  db: Db,
  row: CtacteMovementNote,
  operatorId: string,
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
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
