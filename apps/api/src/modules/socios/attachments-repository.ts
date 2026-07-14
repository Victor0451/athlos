import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import {
  socioAttachments,
  type AttachmentCategory,
  type NewSocioAttachment,
  type SocioAttachment,
} from '@athlos/db/schema'

/**
 * `socio_attachments` repository — thin Drizzle wrapper.
 *
 * Every function takes a `Db | Tx` so the service can compose them
 * inside the FOR SHARE quota transaction (see `attachments.ts`).
 *
 * Soft-delete semantics: rows with `deleted_at IS NOT NULL` are
 * invisible to the public read paths. `softDelete()` flips the
 * `deleted_at` + `deleted_by` columns; the on-disk file is NOT
 * removed here (retention is a future cron — out of scope for PR 8c.1).
 *
 * PR 8c.1 (athlos-socio-legajo).
 */

export interface ListBySocioOptions {
  /** Filter by `category` (one of the 5 enum values). */
  category?: AttachmentCategory
  /** When true, include soft-deleted rows in the result. */
  includeDeleted?: boolean
}

/**
 * List active attachments for a socio, newest first.
 *
 * Excludes soft-deleted rows by default. Pass `includeDeleted: true`
 * for admin / forensic paths.
 */
export async function listBySocio(
  db: Db,
  socioId: string,
  opts: ListBySocioOptions = {},
): Promise<SocioAttachment[]> {
  const conds = [eq(socioAttachments.socioId, socioId)]
  if (!opts.includeDeleted) {
    conds.push(isNull(socioAttachments.deletedAt))
  }
  if (opts.category) {
    conds.push(eq(socioAttachments.category, opts.category))
  }
  // The standin's `orderBy()` returns a chain that is only
  // awaitable once `.limit()` is called. Production drizzle
  // accepts the same shape; we cap at Number.MAX_SAFE_INTEGER to
  // effectively mean "no limit" — the `index('..._uploaded_at_idx')`
  // migration keeps this cheap up to 100 rows per socio (the cap).
  return db
    .select()
    .from(socioAttachments)
    .where(and(...conds))
    .orderBy(desc(socioAttachments.uploadedAt))
    .limit(Number.MAX_SAFE_INTEGER)
}

/**
 * Find a single attachment row by id. Returns soft-deleted rows too —
 * the caller decides whether to treat them as 404 or as a historical
 * lookup.
 */
export async function findById(
  db: Db,
  id: string,
  _opts: { includeDeleted?: boolean } = {},
): Promise<SocioAttachment | null> {
  const [row] = await db.select().from(socioAttachments).where(eq(socioAttachments.id, id)).limit(1)
  return row ?? null
}

/**
 * Insert a new attachment row. Returns the persisted row (with
 * `id`, `uploadedAt` populated by the DB).
 */
export async function insert(db: Db, row: NewSocioAttachment): Promise<SocioAttachment> {
  const [inserted] = await db.insert(socioAttachments).values(row).returning()
  if (!inserted) {
    throw new Error('insert returned no row')
  }
  return inserted
}

/**
 * Soft-delete an attachment row. Returns `true` when an active row
 * was transitioned; `false` when the row was already deleted or
 * absent (idempotent).
 */
export async function softDelete(db: Db, id: string, operatorId: string): Promise<boolean> {
  const result = await db
    .update(socioAttachments)
    .set({ deletedAt: new Date(), deletedBy: operatorId })
    .where(and(eq(socioAttachments.id, id), isNull(socioAttachments.deletedAt)))
    .returning({ id: socioAttachments.id })
  return result.length > 0
}

/**
 * Hard-delete an attachment row. Returns its id and storage path when
 * removed (regardless of its `deleted_at` state); `null` when the id
 * was absent (idempotent on retry).
 *
 * `S3.foundation / PR 5`: the safe compensation primitive that
 * S2.c / registerPayment calls inside its open `db.transaction(...)`
 * to roll back a newly-created comprobante attachment after a
 * failed audit emission. Hard-delete is required because soft-delete
 * would leave an "active-looking" row in the count and never unlink
 * the file.
 *
 * `softDelete` semantics are intentionally preserved unchanged —
 * see the dedicated test in `attachments.compensation.test.ts`.
 */
export async function remove(
  db: Db,
  id: string,
): Promise<{ id: string; storagePath: string } | null> {
  const result = await db
    .delete(socioAttachments)
    .where(eq(socioAttachments.id, id))
    .returning({ id: socioAttachments.id, storagePath: socioAttachments.storagePath })
  return result[0] ?? null
}

/** Test helper: clear all attachments for a socio. Not exported from the module barrel. */
export async function clearForSocio(db: Db, socioId: string): Promise<void> {
  await db.delete(socioAttachments).where(eq(socioAttachments.socioId, socioId))
}
