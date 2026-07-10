import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const operatorsValues = vi.fn()

vi.mock('./ctacte_movement_notes_repository.ts', () => ({
  listNotesByMovement: (...args: unknown[]) => repoListNotesByMovement(...args),
  insertNote: (...args: unknown[]) => repoInsertNote(...args),
  softDeleteNote: (...args: unknown[]) => repoSoftDeleteNote(...args),
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

    // Track the audit insert call separately
    const auditValues = vi.fn().mockResolvedValueOnce({ id: 'audit-1' })
    const auditDb = {
      ...buildDb(),
      insert: () => ({ values: (...args: unknown[]) => auditValues(...args) }),
    }

    const result = await addNote(auditDb as never, {
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
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    )
    expect(auditValues).toHaveBeenCalledTimes(1)
    const auditRow = auditValues.mock.calls[0]![0]
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
    const auditValues = vi.fn()
    const auditDb = {
      ...buildDb(),
      insert: () => ({ values: (...args: unknown[]) => auditValues(...args) }),
    }

    await softDeleteNote(auditDb as never, 'n-1', OPERATOR_ID)

    expect(repoSoftDeleteNote).toHaveBeenCalledWith(expect.anything(), 'n-1')
    // Spec invariant: the original CTACTE_MOVEMENT_NOTE_ADDED audit
    // row remains the historical record; soft-delete does not append
    // a new audit_events row.
    expect(auditValues).not.toHaveBeenCalled()
  })
})
