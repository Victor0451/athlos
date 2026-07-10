import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ErrorCode } from '@athlos/errors'
import { addNote, listNotes, softDeleteNote } from './ctacte_movement_notes.ts'

/**
 * `ctacte_movement_notes` service tests (PR A1a — athlos-ctacte-mutations).
 *
 * The repository is mocked at the module boundary so we can pin the
 * service contract (audit metadata shape, operator enrichment) without
 * spinning up the standin. Per #263 R4 the mock factory is synchronous.
 *
 * The mock db supports only the `db.select().from(operators).where(inArray())`
 * join that the service uses for OperatorChip enrichment.
 */

const repoListNotesByMovement = vi.fn()
const repoInsertNote = vi.fn()
const repoSoftDeleteNote = vi.fn()
const repoFindNoteById = vi.fn()
const repoFindNoteByIdempotencyKey = vi.fn().mockResolvedValue(null)
const operatorsValues = vi.fn()
const emitAuditMock = vi.fn().mockResolvedValue({ inserted: true, id: 'audit-1' })

vi.mock('./ctacte_movement_notes_repository.ts', () => ({
  listNotesByMovement: (...args: unknown[]) => repoListNotesByMovement(...args),
  insertNote: (...args: unknown[]) => repoInsertNote(...args),
  softDeleteNote: (...args: unknown[]) => repoSoftDeleteNote(...args),
  findNoteById: (...args: unknown[]) => repoFindNoteById(...args),
  findNoteByIdempotencyKey: (...args: unknown[]) => repoFindNoteByIdempotencyKey(...args),
}))

vi.mock('@athlos/audit', () => ({
  emitAudit: (...args: unknown[]) => emitAuditMock(...args),
}))

vi.mock('@athlos/db/schema', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    operators: { _: { name: 'operators' } },
  }
})

// Minimal db mock: supports the operator enrichment query path
// (`select({...}).from(operators).where(inArray(operators.id, ids)).limit(N)`).
function buildDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const op = {
              then: (
                onFulfilled: (v: unknown) => unknown,
                onRejected?: (e: unknown) => unknown,
              ) => {
                return Promise.resolve(operatorsValues()).then(onFulfilled, onRejected)
              },
            }
            return op
          },
        }),
      }),
    }),
  }
}

const MOVEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_OPERATOR_ID = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listNotes', () => {
  it('returns the notes enriched with operator username + role', async () => {
    repoListNotesByMovement.mockResolvedValueOnce([
      {
        id: 'n-1',
        ctacteMovementId: MOVEMENT_ID,
        body: 'first',
        authorOperatorId: OPERATOR_ID,
        createdAt: new Date('2026-07-09T12:00:00Z'),
        deletedAt: null,
      },
      {
        id: 'n-2',
        ctacteMovementId: MOVEMENT_ID,
        body: 'second',
        authorOperatorId: OTHER_OPERATOR_ID,
        createdAt: new Date('2026-07-09T13:00:00Z'),
        deletedAt: null,
      },
    ])
    operatorsValues.mockReturnValueOnce([
      { id: OPERATOR_ID, username: 'jperez', role: 'O' },
      { id: OTHER_OPERATOR_ID, username: 'mgomez', role: 'A' },
    ])

    const notes = await listNotes(buildDb() as never, MOVEMENT_ID)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toEqual({
      id: 'n-1',
      body: 'first',
      authorOperatorId: OPERATOR_ID,
      authorUsername: 'jperez',
      authorRole: 'OPERADOR',
      createdAt: new Date('2026-07-09T12:00:00Z'),
    })
    expect(notes[1]!.authorUsername).toBe('mgomez')
    expect(notes[1]!.authorRole).toBe('ADMIN')
    expect(repoListNotesByMovement).toHaveBeenCalledWith(expect.anything(), MOVEMENT_ID)
  })

  it('returns authorUsername=null + authorRole=null when the operator row is missing', async () => {
    repoListNotesByMovement.mockResolvedValueOnce([
      {
        id: 'n-1',
        ctacteMovementId: MOVEMENT_ID,
        body: 'orphan',
        authorOperatorId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        createdAt: new Date('2026-07-09T12:00:00Z'),
        deletedAt: null,
      },
    ])
    operatorsValues.mockReturnValueOnce([])

    const notes = await listNotes(buildDb() as never, MOVEMENT_ID)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.authorUsername).toBeNull()
    expect(notes[0]!.authorRole).toBeNull()
  })
})

describe('addNote', () => {
  it('inserts the note and emits CTACTE_MOVEMENT_NOTE_ADDED with 5-key metadata', async () => {
    const inserted = {
      id: 'n-1',
      ctacteMovementId: MOVEMENT_ID,
      body: 'Verificar comprobante físico',
      authorOperatorId: OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00Z'),
      deletedAt: null,
    }
    repoInsertNote.mockResolvedValueOnce(inserted)

    const result = await addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'Verificar comprobante físico',
    })

    expect(result.id).toBe('n-1')
    expect(repoInsertNote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ctacteMovementId: MOVEMENT_ID,
        authorOperatorId: OPERATOR_ID,
        body: 'Verificar comprobante físico',
      }),
    )
    expect(emitAuditMock).toHaveBeenCalledTimes(1)
    const auditRow = emitAuditMock.mock.calls[0]![1]
    expect(auditRow.action).toBe('CTACTE_MOVEMENT_NOTE_ADDED')
    expect(auditRow.entityType).toBe('ctacte_movement_note')
    expect(auditRow.entityId).toBe('n-1')
    expect(auditRow.operatorId).toBe(OPERATOR_ID)
    // 5-key metadata shape pinned by the audit-logger spec delta.
    expect(Object.keys(auditRow.metadata).sort()).toEqual([
      'author_operator_id',
      'body',
      'ctacte_id',
      'movement_id',
      'note_id',
    ])
    expect(auditRow.metadata.body).toBe('Verificar comprobante físico')
    expect(auditRow.metadata.movement_id).toBe(MOVEMENT_ID)
    expect(auditRow.metadata.ctacte_id).toBe(MOVEMENT_ID)
    expect(auditRow.metadata.note_id).toBe('n-1')
    expect(auditRow.metadata.author_operator_id).toBe(OPERATOR_ID)
  })
})

describe('softDeleteNote', () => {
  it('soft-deletes the row and does NOT emit any new audit event', async () => {
    repoFindNoteById.mockResolvedValueOnce({
      id: 'n-1',
      ctacteMovementId: MOVEMENT_ID,
      body: 'old body',
      authorOperatorId: OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00Z'),
      deletedAt: null,
    })

    await softDeleteNote(buildDb() as never, 'n-1', {
      callerOperatorId: OPERATOR_ID,
      callerRole: 'OPERADOR',
      expectedMovementId: MOVEMENT_ID,
    })

    expect(repoFindNoteById).toHaveBeenCalledWith(expect.anything(), 'n-1')
    expect(repoSoftDeleteNote).toHaveBeenCalledWith(expect.anything(), 'n-1')
    // Spec invariant: the original CTACTE_MOVEMENT_NOTE_ADDED audit
    // row remains the historical record; soft-delete does not append
    // a new audit_events row.
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('allows ADMIN to soft-delete any note', async () => {
    repoFindNoteById.mockResolvedValueOnce({
      id: 'n-2',
      ctacteMovementId: MOVEMENT_ID,
      body: 'foreign author',
      authorOperatorId: OTHER_OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00Z'),
      deletedAt: null,
    })

    await softDeleteNote(buildDb() as never, 'n-2', {
      callerOperatorId: OPERATOR_ID,
      callerRole: 'ADMIN',
      expectedMovementId: MOVEMENT_ID,
    })

    expect(repoSoftDeleteNote).toHaveBeenCalledWith(expect.anything(), 'n-2')
  })

  it('returns NOT_FOUND and does NOT soft-delete when the expected movement does not match the note owner', async () => {
    const OTHER_MOVEMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    repoFindNoteById.mockResolvedValueOnce({
      id: 'n-3',
      ctacteMovementId: MOVEMENT_ID,
      body: 'old body',
      authorOperatorId: OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00Z'),
      deletedAt: null,
    })

    await expect(
      softDeleteNote(buildDb() as never, 'n-3', {
        callerOperatorId: OPERATOR_ID,
        callerRole: 'ADMIN',
        expectedMovementId: OTHER_MOVEMENT_ID,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(repoSoftDeleteNote).not.toHaveBeenCalled()
  })

  it('soft-deletes the row when the expected movement matches the note owner', async () => {
    repoFindNoteById.mockResolvedValueOnce({
      id: 'n-3',
      ctacteMovementId: MOVEMENT_ID,
      body: 'old body',
      authorOperatorId: OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00Z'),
      deletedAt: null,
    })

    await softDeleteNote(buildDb() as never, 'n-3', {
      callerOperatorId: OPERATOR_ID,
      callerRole: 'ADMIN',
      expectedMovementId: MOVEMENT_ID,
    })
    expect(repoSoftDeleteNote).toHaveBeenCalledWith(expect.anything(), 'n-3')
  })

  it('rejects a non-author non-ADMIN caller with INSUFFICIENT_PERMISSIONS', async () => {
    repoFindNoteById.mockResolvedValueOnce({
      id: 'n-3',
      ctacteMovementId: MOVEMENT_ID,
      body: 'foreign author',
      authorOperatorId: OTHER_OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00Z'),
      deletedAt: null,
    })

    const promise = softDeleteNote(buildDb() as never, 'n-3', {
      callerOperatorId: OPERATOR_ID,
      callerRole: 'OPERADOR',
      expectedMovementId: MOVEMENT_ID,
    })
    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })
    expect(repoSoftDeleteNote).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the note id does not exist', async () => {
    repoFindNoteById.mockResolvedValueOnce(null)

    await expect(
      softDeleteNote(buildDb() as never, 'n-missing', {
        callerOperatorId: OPERATOR_ID,
        callerRole: 'ADMIN',
        expectedMovementId: MOVEMENT_ID,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(repoSoftDeleteNote).not.toHaveBeenCalled()
  })
})

// ─── R3 fix #2 — durable Idempotency-Key contract (service layer) ──────────────

describe('addNote — durable Idempotency-Key contract', () => {
  const idempotencyKey = 'note-intent-durable-test'

  function insertedNoteFor(key: string, body = 'payload', overrides: Record<string, unknown> = {}) {
    return {
      id: 'n-replay',
      ctacteMovementId: MOVEMENT_ID,
      body,
      authorOperatorId: OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00Z'),
      deletedAt: null,
      idempotencyKey: key,
      ...overrides,
    }
  }

  it('replays an existing note for the same key + same payload (no audit re-emission)', async () => {
    const existing = insertedNoteFor(idempotencyKey)
    repoFindNoteByIdempotencyKey.mockResolvedValueOnce(existing)

    const result = await addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'payload',
      idempotencyKey,
    })

    expect(result.id).toBe(existing.id)
    expect(repoInsertNote).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the same key is reused with a different payload', async () => {
    // Use a sticky mock (not .mockResolvedValueOnce) so both
    // assertions exercise the same conflict path.
    repoFindNoteByIdempotencyKey.mockResolvedValue(insertedNoteFor(idempotencyKey, 'original'))

    await expect(
      addNote(buildDb() as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'changed',
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(ApiError)
    await expect(
      addNote(buildDb() as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'changed',
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(repoInsertNote).not.toHaveBeenCalled()
  })

  it('inserts and emits one audit when the key is brand-new', async () => {
    repoFindNoteByIdempotencyKey.mockResolvedValueOnce(null)
    repoInsertNote.mockResolvedValueOnce(insertedNoteFor(idempotencyKey))

    const result = await addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'first attempt',
      idempotencyKey,
    })

    expect(result.id).toBe('n-replay')
    expect(repoInsertNote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey }),
    )
    expect(emitAuditMock).toHaveBeenCalledTimes(1)
  })

  it('survives process-restart / cross-instance replays (durable key — no WeakMap, no time bucket)', async () => {
    // First call: fresh insert
    repoFindNoteByIdempotencyKey.mockResolvedValueOnce(null)
    repoInsertNote.mockResolvedValueOnce(insertedNoteFor(idempotencyKey))
    await addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'persist across restart',
      idempotencyKey,
    })
    expect(emitAuditMock).toHaveBeenCalledTimes(1)

    // Second call from a fresh process (no in-memory cache). The repo
    // returns the previously-persisted note via the idempotency key.
    repoFindNoteByIdempotencyKey.mockResolvedValueOnce(
      insertedNoteFor(idempotencyKey, 'persist across restart'),
    )
    await addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'persist across restart',
      idempotencyKey,
    })

    expect(emitAuditMock).toHaveBeenCalledTimes(1) // unchanged — no second audit
    expect(repoInsertNote).toHaveBeenCalledTimes(1)
  })
})
