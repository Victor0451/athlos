import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canEditNote, createNote, deleteNote, listForSocio, updateNote } from './notes.ts'

/**
 * `notes` service tests (PR 8b.4).
 *
 * The repository + audit emission are mocked at the module boundary
 * so we can pin the service contract without spinning up the
 * Drizzle standin (which doesn't model `socio_notes` yet). The
 * standin-model extension is a follow-up — these tests cover the
 * service logic, route tests will cover the wire shape.
 */

const repoInsert = vi.fn()
const repoListBySocio = vi.fn()
const repoFindById = vi.fn()
const repoUpdateBody = vi.fn()
const repoRemove = vi.fn()
const repoFindSocio = vi.fn()
const auditValues = vi.fn()

vi.mock('./notes-repository.ts', () => ({
  insert: (...args: unknown[]) => repoInsert(...args),
  listBySocio: (...args: unknown[]) => repoListBySocio(...args),
  findById: (...args: unknown[]) => repoFindById(...args),
  updateBody: (...args: unknown[]) => repoUpdateBody(...args),
  remove: (...args: unknown[]) => repoRemove(...args),
  clearForSocio: vi.fn(),
}))

vi.mock('./repository.ts', () => ({
  findById: (...args: unknown[]) => repoFindSocio(...args),
}))

const dbMock = {
  /**
   * Mimic Drizzle's `db.insert(table).values(row)` chain. We don't
   * care about the table arg — the row is what `values()` receives.
   */
  insert: () => ({ values: (...args: unknown[]) => auditValues(...args) }),
}

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_OPERATOR_ID = '00000000-0000-4000-8000-000000000002'

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n-1',
    socioId: SOCIO_ID,
    operatorId: OPERATOR_ID,
    body: 'Hola',
    createdAt: new Date('2026-07-04T12:00:00Z'),
    updatedAt: new Date('2026-07-04T12:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  repoFindSocio.mockResolvedValue({ id: SOCIO_ID })
})

describe('listForSocio', () => {
  it('returns the notes for the socio (newest first)', async () => {
    repoListBySocio.mockResolvedValueOnce([
      makeNote({ body: 'one' }),
      makeNote({ id: 'n-2', body: 'two' }),
    ])
    const notes = await listForSocio(dbMock as never, SOCIO_ID)
    expect(notes).toHaveLength(2)
    expect(repoListBySocio).toHaveBeenCalledWith(dbMock, SOCIO_ID, 50)
  })

  it('throws NOT_FOUND when the socio does not exist', async () => {
    repoFindSocio.mockResolvedValueOnce(null)
    await expect(listForSocio(dbMock as never, 'nonexistent')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('createNote', () => {
  it('inserts the trimmed note + emits SOCIO_NOTE_CREATED', async () => {
    repoInsert.mockResolvedValueOnce(makeNote({ body: 'Hola' }))
    auditValues.mockResolvedValueOnce({ id: 'audit-1' })

    const note = await createNote(
      dbMock as never,
      SOCIO_ID,
      { body: '  Hola  ', operatorId: OPERATOR_ID },
      { operatorId: OPERATOR_ID, sourceIp: '1.2.3.4' },
    )

    expect(note.body).toBe('Hola')
    expect(repoInsert).toHaveBeenCalledWith(dbMock, {
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      body: 'Hola',
    })
    expect(auditValues).toHaveBeenCalledTimes(1)
    const payload = auditValues.mock.calls[0]![0]
    expect(payload.action).toBe('SOCIO_NOTE_CREATED')
    expect(payload.entityType).toBe('socio')
    expect(payload.entityId).toBe(SOCIO_ID)
    expect(payload.operatorId).toBe(OPERATOR_ID)
    expect(payload.sourceIp).toBe('1.2.3.4')
  })

  it('throws NOT_FOUND when the socio does not exist (no audit row)', async () => {
    repoFindSocio.mockResolvedValueOnce(null)
    await expect(
      createNote(
        dbMock as never,
        'missing',
        { body: 'x', operatorId: OPERATOR_ID },
        { operatorId: OPERATOR_ID, sourceIp: null },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(auditValues).not.toHaveBeenCalled()
  })
})

describe('edit / delete permission gate (canEditNote)', () => {
  const note = makeNote({ operatorId: OPERATOR_ID })

  it('returns true for the author', () => {
    expect(canEditNote(note, { callerOperatorId: OPERATOR_ID, callerRole: 'OPERADOR' })).toBe(true)
  })

  it('returns true for any ADMIN (even non-author)', () => {
    expect(
      canEditNote(note, {
        callerOperatorId: OTHER_OPERATOR_ID,
        callerRole: 'ADMIN',
      }),
    ).toBe(true)
  })

  it('returns false for a non-author non-ADMIN', () => {
    expect(
      canEditNote(note, {
        callerOperatorId: OTHER_OPERATOR_ID,
        callerRole: 'OPERADOR',
      }),
    ).toBe(false)
    expect(
      canEditNote(note, {
        callerOperatorId: OTHER_OPERATOR_ID,
        callerRole: 'TESORERO',
      }),
    ).toBe(false)
    expect(
      canEditNote(note, {
        callerOperatorId: OTHER_OPERATOR_ID,
        callerRole: 'CONSULTA',
      }),
    ).toBe(false)
  })
})

describe('updateNote', () => {
  it('updates the body and emits SOCIO_NOTE_UPDATED with the before/after snapshots', async () => {
    const before = makeNote({ body: 'Antes' })
    const after = makeNote({ body: 'Después' })
    repoFindById.mockResolvedValueOnce(before)
    repoUpdateBody.mockResolvedValueOnce(after)
    auditValues.mockResolvedValueOnce({ id: 'audit-1' })

    const updated = await updateNote(
      dbMock as never,
      'n-1',
      { body: '  Después  ' },
      { callerOperatorId: OPERATOR_ID, callerRole: 'OPERADOR' },
      { operatorId: OPERATOR_ID, sourceIp: null },
    )

    expect(updated.body).toBe('Después')
    expect(repoUpdateBody).toHaveBeenCalledWith(dbMock, 'n-1', 'Después')
    const payload = auditValues.mock.calls[0]![0]
    expect(payload.action).toBe('SOCIO_NOTE_UPDATED')
    expect(payload.oldValue).toEqual(before)
    expect(payload.newValue).toEqual(after)
  })

  it('rejects a non-author non-ADMIN caller with INSUFFICIENT_PERMISSIONS', async () => {
    repoFindById.mockResolvedValueOnce(makeNote({ operatorId: OPERATOR_ID }))
    await expect(
      updateNote(
        dbMock as never,
        'n-1',
        { body: 'intento' },
        { callerOperatorId: OTHER_OPERATOR_ID, callerRole: 'OPERADOR' },
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' })
    expect(repoUpdateBody).not.toHaveBeenCalled()
    expect(auditValues).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the note does not exist', async () => {
    repoFindById.mockResolvedValueOnce(null)
    await expect(
      updateNote(
        dbMock as never,
        'missing',
        { body: 'x' },
        { callerOperatorId: OPERATOR_ID, callerRole: 'OPERADOR' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it("allows an ADMIN to edit another operator's note", async () => {
    const before = makeNote({ operatorId: OPERATOR_ID })
    repoFindById.mockResolvedValueOnce(before)
    repoUpdateBody.mockResolvedValueOnce({ ...before, body: 'admin fix' })
    const updated = await updateNote(
      dbMock as never,
      'n-1',
      { body: 'admin fix' },
      { callerOperatorId: OTHER_OPERATOR_ID, callerRole: 'ADMIN' },
      { operatorId: OTHER_OPERATOR_ID, sourceIp: null },
    )
    expect(updated.body).toBe('admin fix')
  })
})

describe('deleteNote', () => {
  it('removes the note + emits SOCIO_NOTE_DELETED with the deleted snapshot', async () => {
    const note = makeNote({ operatorId: OPERATOR_ID })
    repoFindById.mockResolvedValueOnce(note)
    repoRemove.mockResolvedValueOnce(note)
    auditValues.mockResolvedValueOnce({ id: 'audit-1' })

    await deleteNote(
      dbMock as never,
      'n-1',
      { callerOperatorId: OPERATOR_ID, callerRole: 'OPERADOR' },
      { operatorId: OPERATOR_ID, sourceIp: null },
    )

    expect(repoRemove).toHaveBeenCalledWith(dbMock, 'n-1')
    const payload = auditValues.mock.calls[0]![0]
    expect(payload.action).toBe('SOCIO_NOTE_DELETED')
    expect(payload.oldValue).toEqual(note)
  })

  it('rejects a non-author non-ADMIN caller with INSUFFICIENT_PERMISSIONS', async () => {
    repoFindById.mockResolvedValueOnce(makeNote({ operatorId: OPERATOR_ID }))
    await expect(
      deleteNote(dbMock as never, 'n-1', {
        callerOperatorId: OTHER_OPERATOR_ID,
        callerRole: 'OPERADOR',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' })
    expect(repoRemove).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the note does not exist', async () => {
    repoFindById.mockResolvedValueOnce(null)
    await expect(
      deleteNote(dbMock as never, 'missing', {
        callerOperatorId: OPERATOR_ID,
        callerRole: 'OPERADOR',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
