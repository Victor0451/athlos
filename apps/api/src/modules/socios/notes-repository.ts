import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { socioNotes, type NewSocioNote, type SocioNote } from '@athlos/db/schema'

/**
 * `socio_notes` repository — thin Drizzle wrapper.
 *
 * Used by `notes.ts` (this module's notes service). Every function
 * takes a `Db | Tx` so the service can compose them inside a
 * transaction if/when notes need to be written atomically with
 * other mutations (e.g. the future "create socio + add onboarding
 * note" flow).
 *
 * Notes are append-only from the user's perspective: edit/delete
 * exist for housekeeping but the audit_events row written at the
 * service layer preserves the historical snapshot. The repository
 * doesn't enforce immutability — that lives one layer up.
 */

export async function listBySocio(db: Db, socioId: string, limit = 50): Promise<SocioNote[]> {
  return db
    .select()
    .from(socioNotes)
    .where(eq(socioNotes.socioId, socioId))
    .orderBy(desc(socioNotes.createdAt))
    .limit(limit)
}

export async function findById(db: Db, id: string): Promise<SocioNote | null> {
  const [row] = await db.select().from(socioNotes).where(eq(socioNotes.id, id)).limit(1)
  return row ?? null
}

export async function insert(db: Db, row: NewSocioNote): Promise<SocioNote> {
  const [inserted] = await db.insert(socioNotes).values(row).returning()
  if (!inserted) {
    // Defensive: returning() always yields at least one row for a
    // single INSERT. If this branch ever fires it's a driver-level
    // anomaly, not a normal validation failure.
    throw new Error('insert returned no row')
  }
  return inserted
}

export async function updateBody(db: Db, id: string, body: string): Promise<SocioNote | null> {
  const [row] = await db
    .update(socioNotes)
    .set({ body, updatedAt: new Date() })
    .where(eq(socioNotes.id, id))
    .returning()
  return row ?? null
}

export async function remove(db: Db, id: string): Promise<SocioNote | null> {
  const [row] = await db.delete(socioNotes).where(eq(socioNotes.id, id)).returning()
  return row ?? null
}

/** Internal: used by tests to seed fresh notes. Not exported from the module barrel. */
export async function clearForSocio(db: Db, socioId: string): Promise<void> {
  await db.delete(socioNotes).where(and(eq(socioNotes.socioId, socioId)))
}
