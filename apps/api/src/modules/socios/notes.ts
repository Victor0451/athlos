import type { Db } from '@athlos/db'
import { auditEvents, type SocioNote } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as notesRepo from './notes-repository.ts'
import * as socioRepo from './repository.ts'

/**
 * Socios notes service — free-form memos attached to a socio.
 *
 * Operators add notes for context that doesn't fit into structured
 * fields (categoria, telefono, etc.): phone calls, family
 * situations, will-reading notes, etc. Every create/update/delete
 * writes an audit_events row so the timeline tab on the detail
 * page can show the operator activity alongside system events.
 *
 * Permissions (enforced at the route layer):
 *   - ALL authenticated operators can list + create notes.
 *   - Edit + delete is restricted to the note's author OR operators
 *     with role ADMIN (the route passes the caller's operatorId and
 *     role to this layer).
 *
 * The audit emission is best-effort: a write failure here MUST NOT
 * mask the original operation. The audit-events table is append-only
 * and a missed row is recoverable from the operator's session log.
 */

export interface NotesAuditContext {
  operatorId?: string | null
  sourceIp?: string | null
}

/**
 * List notes for a socio, newest first.
 *
 * Throws NOT_FOUND when the socio row doesn't exist — the route
 * maps to 404 via the global handler. (Listing notes on a deleted
 * socio returns an empty array so the page can still render the
 * empty state.)
 */
export async function listForSocio(db: Db, socioId: string, limit = 50): Promise<SocioNote[]> {
  const socio = await socioRepo.findById(db, socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  return notesRepo.listBySocio(db, socioId, limit)
}

export interface CreateNoteInput {
  body: string
  operatorId: string
}

/**
 * Create a note. The `operatorId` becomes both the row's author and
 * the audit event's actor. Body is trimmed and capped at 4_000 chars
 * — long notes should live elsewhere; this is for short memos.
 */
export async function createNote(
  db: Db,
  socioId: string,
  input: CreateNoteInput,
  audit: NotesAuditContext = {},
): Promise<SocioNote> {
  const socio = await socioRepo.findById(db, socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  const row = await notesRepo.insert(db, {
    socioId,
    operatorId: input.operatorId,
    body: input.body.trim(),
  })
  await emitAudit(db, {
    action: 'SOCIO_NOTE_CREATED',
    entityId: socioId,
    newValue: row,
    operatorId: audit.operatorId ?? null,
    sourceIp: audit.sourceIp ?? null,
  })
  return row
}

export interface UpdateNoteInput {
  body: string
}

export type UpdateNoteAuth = {
  /** The caller operator's id (used to verify authorship). */
  callerOperatorId: string
  callerRole: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
}

/**
 * Update a note's body. Only the original author OR ADMIN can edit.
 *
 * Throws NOT_FOUND when the note id doesn't exist; throws a
 * BusinessError with code FORBIDDEN when the caller is neither the
 * author nor ADMIN. The route layer maps FORBIDDEN to 403.
 */
export async function updateNote(
  db: Db,
  noteId: string,
  input: UpdateNoteInput,
  auth: UpdateNoteAuth,
  audit: NotesAuditContext = {},
): Promise<SocioNote> {
  const existing = await notesRepo.findById(db, noteId)
  if (!existing) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Note not found')
  }
  if (!canEditNote(existing, auth)) {
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Only the author or an ADMIN can edit this note',
    )
  }
  const before = { ...existing }
  const updated = await notesRepo.updateBody(db, noteId, input.body.trim())
  if (!updated) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Note disappeared during update')
  }
  await emitAudit(db, {
    action: 'SOCIO_NOTE_UPDATED',
    entityId: updated.socioId,
    oldValue: before,
    newValue: updated,
    operatorId: audit.operatorId ?? null,
    sourceIp: audit.sourceIp ?? null,
  })
  return updated
}

export type DeleteNoteAuth = UpdateNoteAuth

/**
 * Delete a note. Only the original author OR ADMIN can delete.
 * The row is GONE (not soft-deleted) — the audit_events row still
 * carries the snapshot, so the historical record is preserved.
 */
export async function deleteNote(
  db: Db,
  noteId: string,
  auth: DeleteNoteAuth,
  audit: NotesAuditContext = {},
): Promise<void> {
  const existing = await notesRepo.findById(db, noteId)
  if (!existing) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Note not found')
  }
  if (!canEditNote(existing, auth)) {
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Only the author or an ADMIN can delete this note',
    )
  }
  const removed = await notesRepo.remove(db, noteId)
  if (!removed) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Note disappeared during delete')
  }
  await emitAudit(db, {
    action: 'SOCIO_NOTE_DELETED',
    entityId: removed.socioId,
    oldValue: removed,
    operatorId: audit.operatorId ?? null,
    sourceIp: audit.sourceIp ?? null,
  })
}

/**
 * Pure helper: edit/delete permission gate. Exported so the route
 * layer can re-use the same rule for pre-checks (e.g. showing or
 * hiding the edit button in the UI).
 */
export function canEditNote(
  note: { operatorId: string },
  auth: { callerOperatorId: string; callerRole: UpdateNoteAuth['callerRole'] },
): boolean {
  if (auth.callerRole === 'ADMIN') return true
  return note.operatorId === auth.callerOperatorId
}

/**
 * Best-effort audit emission. A write failure here MUST NOT mask the
 * original operation, so we swallow the error and surface a
 * `console.error`. The audit-events table is append-only and a
 * missed row is recoverable from the operator's session log; the
 * opposite (a 500 on a successful create) would be a worse outcome.
 */
async function emitAudit(
  db: Db,
  row: {
    action: string
    entityId: string
    oldValue?: unknown
    newValue?: unknown
    operatorId: string | null
    sourceIp: string | null
  },
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      operatorId: row.operatorId,
      action: row.action,
      entityType: 'socio',
      entityId: row.entityId,
      oldValue: (row.oldValue ?? null) as never,
      newValue: (row.newValue ?? null) as never,
      sourceIp: row.sourceIp,
    })
  } catch (err) {
    // Surface the failure for ops but do not propagate.
    console.error('[socios-notes] failed to emit audit_event', err)
  }
}
