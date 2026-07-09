import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import {
  ctacteMovementNotes,
  type CtacteMovementNote,
  type NewCtacteMovementNote,
} from '@athlos/db/schema'

/**
 * `ctacte_movement_notes` repository — thin Drizzle wrapper.
 *
 * PR A1a (athlos-ctacte-mutations). The schema mirrors the migration
 * 0031 columns; the cross-schema FK to `tesoreria.ctacte.id` is
 * enforced at SQL level (the Drizzle declaration is a loose UUID).
 *
 * Soft-delete semantics: rows with `deleted_at IS NOT NULL` are
 * hidden from `listNotesByMovement`. The underlying row stays so the
 * `audit_events` row can keep referencing it — the
 * `CTACTE_MOVEMENT_NOTE_ADDED` audit event remains queryable after
 * soft-delete (spec delta §"Audit event for soft-deleted note
 * remains queryable").
 */
export interface InsertNoteInput {
  ctacteMovementId: string
  authorOperatorId: string
  body: string
}

/**
 * Insert a new note row. The DB server stamps `id` (gen_random_uuid)
 * and `created_at` (default now()).
 */
export async function insertNote(db: Db, input: InsertNoteInput): Promise<CtacteMovementNote> {
  const row: NewCtacteMovementNote = {
    ctacteMovementId: input.ctacteMovementId,
    authorOperatorId: input.authorOperatorId,
    body: input.body,
  }
  const [inserted] = await db.insert(ctacteMovementNotes).values(row).returning()
  if (!inserted) {
    throw new Error('insert returned no row')
  }
  return inserted
}

/**
 * List active notes for a movement, newest first.
 *
 * Excludes soft-deleted rows (matches spec §"Soft-deleted note is
 * hidden from list"). The production query is `.orderBy(desc(createdAt))`
 * backed by the `idx_ctacte_movement_notes_created` index.
 */
export async function listNotesByMovement(
  db: Db,
  movementId: string,
): Promise<CtacteMovementNote[]> {
  return db
    .select()
    .from(ctacteMovementNotes)
    .where(
      and(
        eq(ctacteMovementNotes.ctacteMovementId, movementId),
        isNull(ctacteMovementNotes.deletedAt),
      ),
    )
    .orderBy(desc(ctacteMovementNotes.createdAt))
    .limit(Number.MAX_SAFE_INTEGER)
}

/**
 * Soft-delete a note row. Sets `deleted_at = now()` and returns.
 *
 * No-op when the row is already soft-deleted (idempotent at the
 * SQL level via the WHERE clause).
 */
export async function softDeleteNote(db: Db, noteId: string): Promise<void> {
  await db
    .update(ctacteMovementNotes)
    .set({ deletedAt: new Date() })
    .where(and(eq(ctacteMovementNotes.id, noteId), isNull(ctacteMovementNotes.deletedAt)))
}
