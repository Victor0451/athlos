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
 *
 * R3 fix #2 — durable idempotency: `insertNote` accepts an
 * `idempotencyKey` argument and uses the schema's
 * `idempotencyKeyUnique` UNIQUE partial index as the conflict
 * target. `findNoteByIdempotencyKey` returns the existing row on
 * replay so service-level dedup survives process restarts.
 */
export interface InsertNoteInput {
  id?: string
  ctacteMovementId: string
  authorOperatorId: string
  body: string
  /** Caller-supplied opaque Idempotency-Key. Optional for
   *  backward-compat with callers that pre-date R3; new callers
   *  MUST provide one and the service layer enforces that contract. */
  idempotencyKey?: string | null
}

/**
 * Insert a new note row. The DB server stamps `id` (gen_random_uuid)
 * and `created_at` (default now()).
 *
 * When `idempotencyKey` is provided the insert uses the schema's
 * UNIQUE partial index as the conflict target — a duplicate key
 * returns `[]` from the conflict-aware insert, and the helper then
 * looks the existing row up and returns it (the "already-completed"
 * idempotency arm).
 */
export async function insertNote(db: Db, input: InsertNoteInput): Promise<CtacteMovementNote> {
  const row: NewCtacteMovementNote = {
    ...(input.id ? { id: input.id } : {}),
    ctacteMovementId: input.ctacteMovementId,
    authorOperatorId: input.authorOperatorId,
    body: input.body,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  }
  const [inserted] = input.idempotencyKey
    ? await db
        .insert(ctacteMovementNotes)
        .values(row)
        .onConflictDoNothing({ target: ctacteMovementNotes.idempotencyKey })
        .returning()
    : await db.insert(ctacteMovementNotes).values(row).returning()
  if (!inserted && input.idempotencyKey) {
    const existing = await findNoteByIdempotencyKey(db, input.idempotencyKey)
    if (existing) return existing
  }
  if (!inserted && input.id) {
    const [existing] = await db
      .select()
      .from(ctacteMovementNotes)
      .where(eq(ctacteMovementNotes.id, input.id))
      .limit(1)
    if (existing) return existing
  }
  if (!inserted) {
    throw new Error('insert returned no row')
  }
  return inserted
}

/**
 * Find a note by its caller-supplied Idempotency-Key. Returns the
 * note (active or soft-deleted) when a row exists for the key, or
 * `null` when no row matches.
 *
 * The note's natural `id` is NOT used here — the durable contract
 * is keyed by the caller-provided `idempotency_key` column so
 * cross-process replays surface the same row.
 */
export async function findNoteByIdempotencyKey(
  db: Db,
  idempotencyKey: string,
): Promise<CtacteMovementNote | null> {
  const [row] = await db
    .select()
    .from(ctacteMovementNotes)
    .where(eq(ctacteMovementNotes.idempotencyKey, idempotencyKey))
    .limit(1)
  return row ?? null
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

/**
 * Find a note by id (including soft-deleted rows). Returns `null`
 * when no row matches. Used by the service to enforce author-or-ADMIN
 * authorization before soft-deleting.
 */
export async function findNoteById(db: Db, noteId: string): Promise<CtacteMovementNote | null> {
  const [row] = await db
    .select()
    .from(ctacteMovementNotes)
    .where(eq(ctacteMovementNotes.id, noteId))
    .limit(1)
  return row ?? null
}
