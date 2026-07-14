import { type Readable } from 'node:stream'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Db } from '@athlos/db'
import {
  attachmentCategory,
  type AttachmentCategory,
  type NewSocioAttachment,
  type SocioAttachment,
} from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { AuditAction, emitAudit } from '@athlos/audit'
import { validateMagic, type AllowedMime } from '../file-storage/magic-byte.ts'
import { type LocalFileStorage } from '../file-storage/local-file-storage.ts'
import * as repo from './attachments-repository.ts'
import * as socioRepo from './repository.ts'

/**
 * `socio_attachments` service — business logic for the 5 Legajo routes.
 *
 * The service composes:
 *   1. The `LocalFileStorage` abstraction (atomic-rename writes +
 *      streaming SHA-256).
 *   2. The `validateMagic` pure function (sniffs the buffer's leading
 *      bytes + PDF trailer).
 *   3. A `SELECT … FOR SHARE` quota transaction (100 files / 500 MB
 *      per socio).
 *   4. The `socio_attachments` repository (Drizzle wrapper).
 *   5. Best-effort audit emission via `@athlos/audit`.
 *
 * The route layer is thin: parse multipart, call into here, shape
 * the response.
 *
 * PR 8c.1 (athlos-socio-legajo).
 */

export const QUOTA_FILES_MAX = 100
export const QUOTA_BYTES_MAX = 500 * 1024 * 1024

/**
 * Typed quota rejection. Surfaced as `BusinessError` (mapped to
 * `400 VALIDATION_ERROR` with `details: { cap, limit, current }`).
 */
export class QuotaError extends Error {
  public override readonly name = 'QuotaError'
  public readonly cap: 'files' | 'bytes'
  public readonly limit: number
  public readonly current: number
  constructor(cap: 'files' | 'bytes', limit: number, current: number) {
    super(`Quota exceeded (${cap}): ${current} / ${limit}`)
    this.cap = cap
    this.limit = limit
    this.current = current
  }
}

/** Thrown when the magic-byte validator rejects the sniffed buffer. */
export class UnsupportedMediaTypeError extends Error {
  public override readonly name = 'UnsupportedMediaTypeError'
  public readonly detected: string
  public readonly allowed: AllowedMime[]
  constructor(detected: string, allowed: AllowedMime[]) {
    super(`Unsupported media type: ${detected}`)
    this.detected = detected
    this.allowed = allowed
  }
}

const ALLOWED_MIMES: AllowedMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]

export interface UploadAttachmentInput {
  socioId: string
  operatorId: string
  fileStream: Readable
  declaredMimeType: string
  filename: string
  description?: string | null
  category: AttachmentCategory
  db: Db
  storage: LocalFileStorage
}

/**
 * Upload a single attachment for a socio.
 *
 * Pipeline:
 *   1. Socio existence check (throws NOT_FOUND → 404).
 *   2. Quota transaction: `SELECT count + sum FOR SHARE` on
 *      `socio_attachments WHERE socio_id=$1 AND deleted_at IS NULL`.
 *      Throws `QuotaError` when either cap is exceeded.
 *   3. `LocalFileStorage.saveStream` writes to `<baseDir>/.tmp/...`
 *      then atomic-renames to `<baseDir>/socios/<socioId>/<aid>.<ext>`.
 *      Returns `{ storagePath, sha256, sizeBytes }`.
 *   4. Magic-byte validation on the just-written file: read it back,
 *      sniff the buffer; on mismatch → unlink + raise
 *      `UnsupportedMediaTypeError` (the route maps to 415).
 *   5. INSERT the row inside the transaction.
 *   6. Commit.
 *   7. Best-effort audit emit (`SOCIO_ATTACHMENT_UPLOADED`). Failure
 *      does NOT roll back the upload (per spec §"Failed audit emission
 *      does not roll back the upload").
 */
export async function uploadAttachment(input: UploadAttachmentInput): Promise<SocioAttachment> {
  // 1. Socio existence check.
  const socio = await socioRepo.findById(input.db, input.socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }

  // Sanitize filename — server-side cap of 255 chars (matches CHECK constraint).
  const safeFilename = sanitizeFilename(input.filename)

  // 2-6. Quota transaction.
  // The transaction holds the FOR SHARE row locks; release on commit.
  // Insert order: stream to disk FIRST (outside the lock — the
  // FOR SHARE lock guards the quota check, not the file write).
  // Actually we want the quota check first; the disk write inside
  // the tx is the standard pattern so a failed write rolls back
  // the (eventual) insert cleanly.
  const txResult = await input.db.transaction(async (tx) => {
    const rows = await runQuotaQuery(tx, input.socioId)
    const count = Number(rows.count)
    const sum = Number(rows.sum)
    if (count >= QUOTA_FILES_MAX) {
      throw raiseQuota('files', QUOTA_FILES_MAX, count)
    }
    if (sum + input.fileStream.readableLength > QUOTA_BYTES_MAX) {
      // sizeBytes unknown at this point; treat the readable
      // buffer as the new payload. This is the best-effort
      // check before we know the actual size — the second
      // pass inside `saveStream` enforces the real limit.
      throw raiseQuota('bytes', QUOTA_BYTES_MAX, sum)
    }

    // 3. Stream the file to disk with a server-generated UUID
    //    so the storage path is stable (matches the eventual row id).
    const attachmentId = randomUUID()
    const storagePath = `socios/${input.socioId}/${attachmentId}.${extFromMime(input.declaredMimeType)}`
    const stored = await input.storage.saveStream(input.fileStream, {
      storagePath,
      mimeType: input.declaredMimeType,
    })

    // 4. Magic-byte validation: read the file back, sniff, decide.
    const buf = await readFileToBuffer(stored.storagePath, input.storage)
    if (!validateMagic(input.declaredMimeType, buf)) {
      // Roll back the disk write before raising.
      await input.storage.unlink(stored.storagePath)
      throw raiseUnsupportedMediaType(input.declaredMimeType)
    }

    // 5. Final quota re-check with the actual bytes — protects
    // against the bytes cap being crossed between the pre-flight
    // and the real size.
    const realSum = sum + stored.sizeBytes
    if (count >= QUOTA_FILES_MAX) {
      await input.storage.unlink(stored.storagePath)
      throw raiseQuota('files', QUOTA_FILES_MAX, count)
    }
    if (realSum > QUOTA_BYTES_MAX) {
      await input.storage.unlink(stored.storagePath)
      throw raiseQuota('bytes', QUOTA_BYTES_MAX, sum)
    }

    // 6. INSERT — pass `id` so storage_path and row id stay aligned.
    const newRow: NewSocioAttachment = {
      id: attachmentId,
      socioId: input.socioId,
      filename: safeFilename,
      description: input.description ?? null,
      category: input.category,
      mimeType: input.declaredMimeType,
      sizeBytes: stored.sizeBytes,
      storagePath: stored.storagePath,
      storageSha256: stored.sha256,
      uploadedBy: input.operatorId,
    }
    const inserted = await repo.insert(tx as unknown as Db, newRow)
    return inserted
  })

  // 7. Best-effort audit emit.
  await emitAttachmentUploadedAudit(input.db, txResult, input.operatorId, null)

  return txResult
}

/**
 * List active attachments for a socio. Optional `?category=` filter.
 */
export async function listAttachments(input: {
  socioId: string
  category?: AttachmentCategory
  db: Db
}): Promise<SocioAttachment[]> {
  const socio = await socioRepo.findById(input.db, input.socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  return repo.listBySocio(input.db, input.socioId, {
    ...(input.category ? { category: input.category } : {}),
  })
}

/** Single attachment metadata fetch. Returns null for unknown / soft-deleted. */
export async function getAttachment(id: string, db: Db): Promise<SocioAttachment | null> {
  const row = await repo.findById(db, id)
  if (!row || row.deletedAt) return null
  return row
}

/** Stream the bytes for an attachment. Returns null for unknown / soft-deleted. */
export async function streamAttachment(
  id: string,
  db: Db,
  storage: LocalFileStorage,
): Promise<{ row: SocioAttachment; stream: Readable } | null> {
  const row = await repo.findById(db, id)
  if (!row || row.deletedAt) return null
  return { row, stream: storage.readStream(row.storagePath) }
}

/**
 * Soft-delete an attachment row. The on-disk file is retained
 * (retention cron is deferred per design §3).
 *
 * Audit is best-effort: failure does not roll back the delete.
 */
export async function softDeleteAttachment(input: {
  id: string
  operatorId: string
  db: Db
}): Promise<void> {
  const existing = await repo.findById(input.db, input.id)
  if (!existing || existing.deletedAt) {
    // Idempotent: nothing to delete.
    return
  }
  const ok = await repo.softDelete(input.db, input.id, input.operatorId)
  if (!ok) return // someone else got there first

  await emitAttachmentDeletedAudit(input.db, existing, input.operatorId, null)
}

/**
 * Safe compensation primitive — remove ONE newly-created attachment
 * row + its file. Intended for callers that just inserted an
 * attachment after a caller transaction rolls back (e.g. when a
 * downstream audit emission fails).
 *
 * Contract (S3.foundation / PR 5):
 *   1. Hard-delete the row in an independent transaction. The file is
 *      not unlinked unless that transaction has committed successfully.
 *   2. After the committed row removal, unlink the deleted row's
 *      `storagePath`. `LocalFileStorage.unlink` is
 *      idempotent on ENOENT.
 *   3. On row-removal failure: the function throws so the caller's
 *      transaction rolls back. The file unlink is NOT attempted.
 *   4. On file-unlink failure AFTER row removal: the function logs
 *      and continues. The row is already gone; a stranded file is
 *      recoverable by the future retention cron.
 *   5. Idempotent on retry: when `remove` returns `null` (the row
 *      is already absent), the function does NOT call `unlink`
 *      again — the row-removal step is the gate.
 *   6. NEVER touches any other row or file. The WHERE clause is
 *      `id = $rowId`; only the named row is deleted.
 */
export async function compensateNewAttachment(
  db: Db,
  rowId: string,
  storage: LocalFileStorage,
): Promise<void> {
  // The transaction resolves only after its DELETE has committed.
  const removed = await db.transaction((tx) => repo.remove(tx as unknown as Db, rowId))

  // 2. Idempotency: if the row was already absent (a prior compensation
  //    succeeded, or the id never existed), skip the unlink. This
  //    prevents spurious `unlink` calls on retry.
  if (!removed) {
    return
  }

  // 3. Unlink the file. LocalFileStorage.unlink is ENOENT-tolerant
  //    (idempotent). On a hard I/O failure, log and continue — the
  //    row is already gone and the stranded file is recoverable by
  //    the future retention cron.
  try {
    await storage.unlink(removed.storagePath)
  } catch (err) {
    console.error(
      '[socio-attachments] compensateNewAttachment: row removed but file unlink failed; stranded file recoverable by retention cron',
      { rowId, storagePath: removed.storagePath, err },
    )
  }
}

// ── helpers ────────────────────────────────────────────────────────

/**
 * Run the quota COUNT + SUM query. Drizzle's `sql` template tag
 * returns the rows; we cast to the narrow shape we expect.
 */
async function runQuotaQuery(
  tx: unknown,
  socioId: string,
): Promise<{ count: number; sum: number }> {
  const txExec = tx as { execute: (q: unknown) => Promise<unknown> }
  const query = sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes), 0)::bigint AS sum
    FROM socio_attachments
    WHERE socio_id = ${socioId} AND deleted_at IS NULL
    FOR SHARE
  `
  const result = (await txExec.execute(query)) as Array<{
    count: number
    sum: number | string
  }>
  const row = result[0] ?? { count: 0, sum: 0 }
  return {
    count: Number(row.count ?? 0),
    sum: Number(row.sum ?? 0),
  }
}

/**
 * Map a declared MIME to a stable file extension for the storage
 * path. Used to build `socios/<id>/<aid>.<ext>`. Falls back to
 * `bin` for unknown types — the validator already rejects those.
 */
function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'application/pdf':
      return 'pdf'
    default:
      return 'bin'
  }
}

/** Convert a QuotaError into the typed BusinessError the route layer maps to 400. */
function raiseQuota(cap: 'files' | 'bytes', limit: number, current: number): never {
  throw BusinessError(ErrorCode.VALIDATION_ERROR, `Quota exceeded (${cap})`, {
    cap,
    limit,
    current,
  })
}

/** Convert an UnsupportedMediaTypeError into the typed BusinessError the route maps to 415. */
function raiseUnsupportedMediaType(detected: string): never {
  throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Unsupported media type', {
    detected,
    allowed: ALLOWED_MIMES,
  })
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().slice(0, 255)
  if (trimmed.length === 0) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'filename is required')
  }
  return trimmed
}

async function readFileToBuffer(storagePath: string, storage: LocalFileStorage): Promise<Buffer> {
  const stream = storage.readStream(storagePath)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function emitAttachmentUploadedAudit(
  db: Db,
  row: SocioAttachment,
  operatorId: string,
  sourceIp: string | null,
): Promise<void> {
  try {
    await emitAudit(db, {
      operatorId,
      action: AuditAction.SOCIO_ATTACHMENT_UPLOADED,
      entityType: 'socio_attachment',
      entityId: row.id,
      oldValue: null,
      newValue: { id: row.id, category: row.category, size_bytes: row.sizeBytes },
      sourceIp,
      payload: { id: row.id, filename: row.filename, size_bytes: row.sizeBytes },
      metadata: {
        attachment_id: row.id,
        filename: row.filename,
        category: row.category,
        size_bytes: row.sizeBytes,
      },
    })
  } catch (err) {
    // Best-effort: a failure here MUST NOT mask the upload.
    console.error('[socio-attachments] failed to emit upload audit', err)
  }
}

async function emitAttachmentDeletedAudit(
  db: Db,
  row: SocioAttachment,
  operatorId: string,
  sourceIp: string | null,
): Promise<void> {
  try {
    await emitAudit(db, {
      operatorId,
      action: AuditAction.SOCIO_ATTACHMENT_DELETED,
      entityType: 'socio_attachment',
      entityId: row.id,
      oldValue: { id: row.id, filename: row.filename, category: row.category },
      newValue: null,
      sourceIp,
      payload: { id: row.id, filename: row.filename },
      metadata: {
        attachment_id: row.id,
        filename: row.filename,
        category: row.category,
        size_bytes: row.sizeBytes,
      },
    })
  } catch (err) {
    console.error('[socio-attachments] failed to emit delete audit', err)
  }
}

// Re-export AttachmentCategory for callers that import from this module.
export type { AttachmentCategory }
export { attachmentCategory }
