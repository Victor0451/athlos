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
const operatorsValues = vi.fn()
const emitAuditMock = vi.fn().mockResolvedValue({ inserted: true, id: 'audit-1' })

vi.mock('./ctacte_movement_notes_repository.ts', () => ({
  listNotesByMovement: (...args: unknown[]) => repoListNotesByMovement(...args),
  insertNote: (...args: unknown[]) => repoInsertNote(...args),
  softDeleteNote: (...args: unknown[]) => repoSoftDeleteNote(...args),
  findNoteById: (...args: unknown[]) => repoFindNoteById(...args),
  // The defect #2 service flow uses the repository's conflict-aware
  // insert (which itself calls `findNoteByIdempotencyKey` on the
  // conflict-loser branch). The service MUST NOT call this helper
  // directly — it leaked the predecessor code path that bypassed the
  // durable UNIQUE INDEX.
  findNoteByIdempotencyKey: () => {
    throw new Error('findNoteByIdempotencyKey should not be called by addNote directly')
  },
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
function buildDb(tx = {} as Record<string, unknown>) {
  const db = {
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
    transaction: vi.fn(<T>(callback: (txHandle: unknown) => Promise<T>) =>
      callback(Object.keys(tx).length > 0 ? tx : db),
    ),
  } as {
    select: () => {
      from: () => {
        where: () => {
          limit: () => PromiseLike<unknown>
        }
      }
    }
    transaction: ReturnType<typeof vi.fn>
  }
  return db
}

const MOVEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_OPERATOR_ID = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
  vi.clearAllMocks()
})

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
    const row = insertedNoteFor('not-applied', 'Verificar comprobante físico', {
      idempotencyKey: undefined,
    })
    repoInsertNote.mockResolvedValueOnce({ row, created: true })

    const db = buildDb()
    const result = await addNote(db as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'Verificar comprobante físico',
    })

    expect(result.id).toBe('n-replay')
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(repoInsertNote).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        ctacteMovementId: MOVEMENT_ID,
        authorOperatorId: OPERATOR_ID,
        body: 'Verificar comprobante físico',
      }),
    )
    expect(emitAuditMock).toHaveBeenCalledTimes(1)
    expect(emitAuditMock.mock.calls[0]![0]).toBe(db)
    const auditRow = emitAuditMock.mock.calls[0]![1]
    expect(auditRow.action).toBe('CTACTE_MOVEMENT_NOTE_ADDED')
    expect(auditRow.entityType).toBe('ctacte_movement_note')
    expect(auditRow.entityId).toBe('n-replay')
    expect(auditRow.operatorId).toBe(OPERATOR_ID)
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
    expect(auditRow.metadata.note_id).toBe('n-replay')
    expect(auditRow.metadata.author_operator_id).toBe(OPERATOR_ID)
  })

  it('uses the transaction handle and caller key for note insert + audit emission', async () => {
    const tx = { marker: 'tx-add-note' }
    const db = buildDb(tx)
    const row = insertedNoteFor('note-caller-key', 'transactional note', {
      idempotencyKey: 'note-caller-key',
    })
    repoInsertNote.mockResolvedValueOnce({ row, created: true })

    await addNote(db as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'transactional note',
      idempotencyKey: 'note-caller-key',
    })

    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(repoInsertNote).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ idempotencyKey: 'note-caller-key' }),
    )
    expect(emitAuditMock).toHaveBeenCalledTimes(1)
    expect(emitAuditMock.mock.calls[0]![0]).toBe(tx)
    expect(emitAuditMock.mock.calls[0]![1]).toMatchObject({ callerKey: 'note-caller-key' })
  })

  it('propagates audit failure so the transaction can roll back the inserted note', async () => {
    const tx = { marker: 'tx-add-note-rollback' }
    const db = buildDb(tx)
    const row = insertedNoteFor('note-rollback-key', 'rollback note', {
      idempotencyKey: 'note-rollback-key',
    })
    repoInsertNote.mockResolvedValueOnce({ row, created: true })
    emitAuditMock.mockRejectedValueOnce(new Error('audit insert failed'))

    await expect(
      addNote(db as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'rollback note',
        idempotencyKey: 'note-rollback-key',
      }),
    ).rejects.toThrow('audit insert failed')

    expect(repoInsertNote).toHaveBeenCalledWith(tx, expect.anything())
    expect(emitAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'CTACTE_MOVEMENT_NOTE_ADDED',
        callerKey: 'note-rollback-key',
      }),
    )
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

// ─── R3 fix #2 + R3 fix batch — defect #2: concurrent same-key semantics ───────────

describe('addNote — durable Idempotency-Key contract (defect #2)', () => {
  const idempotencyKey = 'note-intent-durable-test'

  it('emits exactly one audit when the durable key surfaces an existing row (created: false branch)', async () => {
    // The repository's conflict-loser branch (`created: false`) signals
    // that someone else already persisted the row. The service must
    // NOT emit a second audit, regardless of payload match.
    const existing = insertedNoteFor(idempotencyKey, 'persist across restart')
    repoInsertNote.mockResolvedValueOnce({ row: existing, created: false })

    const result = await addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'persist across restart',
      idempotencyKey,
    })

    expect(result.id).toBe(existing.id)
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the conflict-loser surfaces a row with a different payload', async () => {
    // Sticky mock so both assertions hit the same conflict path.
    repoInsertNote.mockImplementation(async () => ({
      row: insertedNoteFor(idempotencyKey, 'original'),
      created: false,
    }))

    const first = addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'changed',
      idempotencyKey,
    })
    await expect(first).rejects.toBeInstanceOf(ApiError)
    await expect(first).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

    const second = addNote(buildDb() as never, {
      ctacteMovementId: MOVEMENT_ID,
      operatorId: OPERATOR_ID,
      body: 'changed',
      idempotencyKey,
    })
    await expect(second).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the conflict-loser surfaces a row from a different operator (stolen/replayed key)', async () => {
    repoInsertNote.mockResolvedValueOnce({
      row: insertedNoteFor(idempotencyKey, 'mismo cuerpo', {
        authorOperatorId: OTHER_OPERATOR_ID,
      }),
      created: false,
    })

    await expect(
      addNote(buildDb() as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'mismo cuerpo',
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it('inserts and emits one audit when the key is brand-new (created: true branch)', async () => {
    const row = insertedNoteFor(idempotencyKey, 'first attempt', { idempotencyKey })
    repoInsertNote.mockResolvedValueOnce({ row, created: true })

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

  it('two concurrent same-key + same-payload calls emit exactly one audit (creator + loser branch)', async () => {
    // Simulate the race where one API replica wins the index race
    // (created: true) and the other surfaces the same row as
    // created: false. Audit MUST fire exactly once.
    const winner = insertedNoteFor(idempotencyKey, 'persist across restart', {
      idempotencyKey,
    })
    const loser = insertedNoteFor(idempotencyKey, 'persist across restart', {
      idempotencyKey,
    })
    repoInsertNote.mockImplementationOnce(async () => ({ row: winner, created: true }))
    repoInsertNote.mockImplementationOnce(async () => ({ row: loser, created: false }))

    await Promise.all([
      addNote(buildDb() as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'persist across restart',
        idempotencyKey,
      }),
      addNote(buildDb() as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'persist across restart',
        idempotencyKey,
      }),
    ])

    expect(emitAuditMock).toHaveBeenCalledTimes(1)
  })

  it('two concurrent same-key + different-body calls emit exactly one audit + surface a CONFLICT', async () => {
    const existing = insertedNoteFor(idempotencyKey, 'original', { idempotencyKey })
    repoInsertNote.mockImplementationOnce(async () => ({ row: existing, created: true }))
    repoInsertNote.mockImplementationOnce(async () => ({ row: existing, created: false }))

    const results = await Promise.allSettled([
      addNote(buildDb() as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'original',
        idempotencyKey,
      }),
      addNote(buildDb() as never, {
        ctacteMovementId: MOVEMENT_ID,
        operatorId: OPERATOR_ID,
        body: 'concurrent-different-body',
        idempotencyKey,
      }),
    ])

    // Creator wins; loser sees the created=false branch with a
    // non-matching payload and is rejected with CONFLICT.
    expect(results[0]!.status).toBe('fulfilled')
    expect(results[1]!.status).toBe('rejected')
    const err = (results[1] as PromiseRejectedResult).reason
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: ErrorCode.CONFLICT })

    expect(emitAuditMock).toHaveBeenCalledTimes(1)
  })
})
