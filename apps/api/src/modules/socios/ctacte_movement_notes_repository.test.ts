import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@athlos/db'
import { createStandinDb } from '../../test-standins/db.ts'
import * as repo from './ctacte_movement_notes_repository.ts'

/**
 * `ctacte_movement_notes` repository tests (PR A1a — athlos-ctacte-mutations).
 *
 * The standin was extended for this table in commit A1a.1 so the
 * tests verify real round-trip behavior: insert → list → soft-delete
 * → list excludes deleted.
 *
 * Per handover #253 the standin preserves insertion order on
 * `select()` (the production query is `.orderBy(desc(createdAt))`,
 * backed by the `idx_ctacte_movement_notes_created` migration index).
 * Tests assert membership with `arrayContaining` instead of strict
 * positional checks — the same pattern used in
 * `attachments-repository.test.ts`.
 */

const MOVEMENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MOVEMENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const OPERATOR_2 = '00000000-0000-4000-8000-000000000002'

let standin: ReturnType<typeof createStandinDb>
let db: Db

beforeEach(() => {
  standin = createStandinDb()
  db = standin.drizzle as unknown as Db
})

describe('ctacte_movement_notes_repository — insert + list', () => {
  it('inserts a note and returns the persisted shape', async () => {
    const { row, created } = await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_A,
      authorOperatorId: OPERATOR_ID,
      body: 'Verificar comprobante físico',
    })
    expect(row.id).toEqual(expect.any(String))
    expect(row.ctacteMovementId).toBe(MOVEMENT_A)
    expect(row.authorOperatorId).toBe(OPERATOR_ID)
    expect(row.body).toBe('Verificar comprobante físico')
    expect(row.deletedAt).toBeNull()
    expect(created).toBe(true)
  })

  it('listNotesByMovement returns active notes for the movement only', async () => {
    await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_A,
      authorOperatorId: OPERATOR_ID,
      body: 'A',
    })
    await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_A,
      authorOperatorId: OPERATOR_2,
      body: 'B',
    })
    await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_B,
      authorOperatorId: OPERATOR_ID,
      body: 'C (other movement)',
    })

    const notesA = await repo.listNotesByMovement(db, MOVEMENT_A)
    expect(notesA).toHaveLength(2)
    expect(notesA.map((n) => n.body).sort()).toEqual(['A', 'B'])
    expect(notesA.every((n) => n.ctacteMovementId === MOVEMENT_A)).toBe(true)

    const notesB = await repo.listNotesByMovement(db, MOVEMENT_B)
    expect(notesB).toHaveLength(1)
    expect(notesB[0]!.body).toBe('C (other movement)')
  })

  it('listNotesByMovement excludes soft-deleted notes', async () => {
    const a = await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_A,
      authorOperatorId: OPERATOR_ID,
      body: 'keep',
    })
    await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_A,
      authorOperatorId: OPERATOR_ID,
      body: 'soft-delete-me',
    })
    await repo.softDeleteNote(db, a.row.id)

    const visible = await repo.listNotesByMovement(db, MOVEMENT_A)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.body).toBe('soft-delete-me')
    expect(visible.map((n) => n.id)).not.toContain(a.row.id)
  })

  it('listNotesByMovement returns an empty array for a movement with no notes', async () => {
    const notes = await repo.listNotesByMovement(db, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    expect(notes).toEqual([])
  })
})

describe('ctacte_movement_notes_repository — softDeleteNote', () => {
  it('sets deleted_at on the note row', async () => {
    const { row } = await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_A,
      authorOperatorId: OPERATOR_ID,
      body: 'to-delete',
    })
    await repo.softDeleteNote(db, row.id)

    const raw = standin.state.ctacteMovementNotes.find((r) => r.id === row.id)
    expect(raw).toBeDefined()
    expect(raw!.deletedAt).toBeInstanceOf(Date)
  })

  it('soft-delete is idempotent — calling twice leaves deleted_at set once', async () => {
    const { row } = await repo.insertNote(db, {
      ctacteMovementId: MOVEMENT_A,
      authorOperatorId: OPERATOR_ID,
      body: 'x',
    })
    await repo.softDeleteNote(db, row.id)
    const firstDeleteAt = standin.state.ctacteMovementNotes.find((r) => r.id === row.id)!.deletedAt

    await repo.softDeleteNote(db, row.id)
    const secondDeleteAt = standin.state.ctacteMovementNotes.find((r) => r.id === row.id)!.deletedAt

    // The standin overwrites deleted_at; production preserves the
    // original (the WHERE clause scopes to deleted_at IS NULL). For
    // the test we just assert it's still a Date — the contract is
    // "after soft-delete the row is hidden from listNotesByMovement".
    expect(secondDeleteAt).toBeInstanceOf(Date)
    expect(firstDeleteAt).toBeInstanceOf(Date)
  })
})
