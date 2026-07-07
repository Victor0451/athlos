import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * SocioNotesCard tests (PR 8b.4 + PR 8b.5 B.4).
 *
 * Mocks the 4 socio-notes API calls at the module boundary so the
 * tests can drive the happy path of list / create / update /
 * delete without depending on the apiFetch pipeline. The auth
 * mock exposes `operator_id` + `role` to pin the edit/delete
 * gating.
 *
 * PR 8b.5 B.4 adds the operator-name lookup wiring: when the
 * `getOperatorNames` mock returns the note author's id, the note
 * author chip renders `username · ROLE`; when it returns `[]`,
 * the chip renders `Operador desconocido` (OperatorChip fallback
 * case 2 — id missing from lookup).
 */

const listSocioNotesMock = vi.fn()
const createSocioNoteMock = vi.fn()
const updateSocioNoteMock = vi.fn()
const deleteSocioNoteMock = vi.fn()
const useAuthMock = vi.fn()
const getOperatorNamesMock = vi.fn()

vi.mock('@/lib/api/socios', () => ({
  NOTE_MAX_LENGTH: 4000,
  listSocioNotes: (...args: unknown[]) => listSocioNotesMock(...args),
  createSocioNote: (...args: unknown[]) => createSocioNoteMock(...args),
  updateSocioNote: (...args: unknown[]) => updateSocioNoteMock(...args),
  deleteSocioNote: (...args: unknown[]) => deleteSocioNoteMock(...args),
  getSocio: vi.fn(),
  createSocio: vi.fn(),
  updateSocio: vi.fn(),
  deleteSocio: vi.fn(),
  getSocios: vi.fn(),
  getSociosAggregate: vi.fn(),
  getSocioAudit: vi.fn(),
}))

vi.mock('@/lib/api/operators', () => ({
  // The mock factory must stay SYNCHRONOUS (design R4). `OPERATORS_QUERY_KEY`
  // is re-declared here because the real module is replaced wholesale by
  // vi.mock — if the production implementation drifts (e.g. adds a hash),
  // update this stub AND the real export in lockstep.
  OPERATORS_QUERY_KEY: (sortedIds: readonly string[]) =>
    ['operators', sortedIds.join(',')] as const,
  getOperatorNames: (...args: unknown[]) => getOperatorNamesMock(...args),
}))

vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { SocioNotesCard } = await import('./SocioNotesCard')

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n-1',
    socio_id: SOCIO_ID,
    operator_id: OPERATOR_ID,
    body: 'Llamó el lunes para renovar la cuota',
    created_at: '2026-07-04T12:00:00.000Z',
    updated_at: '2026-07-04T12:00:00.000Z',
    ...overrides,
  }
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SocioNotesCard socioId={SOCIO_ID} />
    </QueryClientProvider>,
  )
}

function makeAdminUser() {
  return {
    user: {
      operator_id: OPERATOR_ID,
      role: 'ADMIN' as const,
      username: 'admin',
      permissions: { can_reprint: true, can_anulate: true },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

function makeOperadorUser() {
  return {
    user: {
      operator_id: 'other-operator',
      role: 'OPERADOR' as const,
      username: 'op',
      permissions: { can_reprint: false, can_anulate: false },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.confirm = vi.fn().mockReturnValue(true)
  useAuthMock.mockReturnValue(makeAdminUser())
  listSocioNotesMock.mockResolvedValue([])
})

describe('SocioNotesCard', () => {
  it('renders the card title + the empty state', async () => {
    renderCard()
    expect(screen.getByTestId('socio-notes-card')).toBeInTheDocument()
    expect(screen.getByText(/Notas del operador/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('socio-notes-empty')).toBeInTheDocument()
    })
  })

  it('renders the existing notes with author + body + timestamps', async () => {
    listSocioNotesMock.mockResolvedValueOnce([
      makeNote({ id: 'n-1', body: 'Primer memo' }),
      makeNote({
        id: 'n-2',
        body: 'Segundo memo',
        created_at: '2026-07-05T08:30:00.000Z',
        updated_at: '2026-07-05T08:30:00.000Z',
      }),
    ])
    // No getOperatorNamesMock setup → operatorMap is empty → the
    // chip falls back to "Operador desconocido" for both notes.
    renderCard()
    await waitFor(() => {
      expect(screen.getByTestId('socio-note-n-1')).toBeInTheDocument()
    })
    expect(screen.getByText('Primer memo')).toBeInTheDocument()
    expect(screen.getByText('Segundo memo')).toBeInTheDocument()
    expect(screen.getByTestId('socio-note-author-n-1')).toHaveTextContent('Operador desconocido')
  })

  it('submits a new note via the form', async () => {
    createSocioNoteMock.mockResolvedValueOnce(makeNote())
    renderCard()

    const textarea = await screen.findByTestId('socio-note-new-body')
    fireEvent.change(textarea, { target: { value: '  nueva nota  ' } })
    fireEvent.click(screen.getByTestId('socio-note-new-submit'))

    await waitFor(() => {
      expect(createSocioNoteMock).toHaveBeenCalledWith(SOCIO_ID, 'nueva nota')
    })
  })

  it('disables the submit button when the draft is empty', async () => {
    renderCard()
    expect(screen.getByTestId('socio-note-new-submit')).toBeDisabled()
  })

  it('shows edit + delete buttons only for the author OR an ADMIN', async () => {
    listSocioNotesMock.mockResolvedValueOnce([makeNote({ id: 'mine' })])
    // OPERADOR that is the owner
    useAuthMock.mockReturnValue({
      ...makeOperadorUser(),
      user: {
        operator_id: OPERATOR_ID,
        role: 'OPERADOR' as const,
        username: 'op',
        permissions: { can_reprint: false, can_anulate: false },
      },
    })
    renderCard()
    await waitFor(() => {
      expect(screen.getByTestId('socio-note-edit-mine')).toBeInTheDocument()
    })
    expect(screen.getByTestId('socio-note-delete-mine')).toBeInTheDocument()
  })

  it('hides edit + delete for a non-author non-ADMIN', async () => {
    listSocioNotesMock.mockResolvedValueOnce([makeNote({ id: 'foreign' })])
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderCard()
    await waitFor(() => {
      expect(screen.getByTestId('socio-note-foreign')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('socio-note-edit-foreign')).not.toBeInTheDocument()
    expect(screen.queryByTestId('socio-note-delete-foreign')).not.toBeInTheDocument()
  })

  it('opens the edit form, saves the body, calls updateSocioNote', async () => {
    listSocioNotesMock.mockResolvedValueOnce([makeNote({ id: 'n-1' })])
    updateSocioNoteMock.mockResolvedValueOnce(makeNote({ id: 'n-1', body: 'editado' }))
    renderCard()
    await waitFor(() => screen.getByTestId('socio-note-edit-n-1'))
    fireEvent.click(screen.getByTestId('socio-note-edit-n-1'))
    const editBody = await screen.findByTestId('socio-note-edit-body-n-1')
    fireEvent.change(editBody, { target: { value: '  editado  ' } })
    fireEvent.click(screen.getByTestId('socio-note-edit-save-n-1'))
    await waitFor(() => {
      expect(updateSocioNoteMock).toHaveBeenCalledWith(SOCIO_ID, 'n-1', 'editado')
    })
  })

  it('confirms before delete and calls deleteSocioNote', async () => {
    listSocioNotesMock.mockResolvedValueOnce([makeNote({ id: 'n-1' })])
    deleteSocioNoteMock.mockResolvedValueOnce(undefined)
    renderCard()
    await waitFor(() => screen.getByTestId('socio-note-delete-n-1'))
    fireEvent.click(screen.getByTestId('socio-note-delete-n-1'))
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled()
      expect(deleteSocioNoteMock).toHaveBeenCalledWith(SOCIO_ID, 'n-1')
    })
  })

  /* ── PR 8b.5 B.4: operator-name lookup wiring ────────────────────── */

  it('renders "username · ROLE" for a note whose author id is in the operator lookup', async () => {
    listSocioNotesMock.mockResolvedValueOnce([makeNote({ id: 'n-known' })])
    getOperatorNamesMock.mockResolvedValueOnce([
      { id: OPERATOR_ID, username: 'vlongo', role: 'ADMIN' as const },
    ])

    renderCard()
    await waitFor(() => {
      expect(screen.getByTestId('socio-note-n-known')).toBeInTheDocument()
    })
    // Wait for the operators query to settle — the chip text flips
    // from "Operador desconocido" (empty map while pending) to
    // "vlongo · ADMIN" once the lookup resolves.
    await waitFor(() => {
      expect(screen.getByTestId('socio-note-author-n-known')).toHaveTextContent('vlongo · ADMIN')
    })
    // Belt-and-braces: pin the known chip's data-testid so a future
    // refactor of OperatorChip that swaps the testid would surface.
    expect(screen.getByTestId('operator-chip-known')).toBeInTheDocument()
  })

  it('renders "Operador desconocido" for a note whose author id is missing from the lookup', async () => {
    listSocioNotesMock.mockResolvedValueOnce([makeNote({ id: 'n-orphan' })])
    // Empty lookup → OperatorChip case 2: id missing from map
    // → fallback. Also covers the empty-map-while-pending case.
    getOperatorNamesMock.mockResolvedValueOnce([])

    renderCard()
    await waitFor(() => {
      expect(screen.getByTestId('socio-note-n-orphan')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByTestId('socio-note-author-n-orphan')).toHaveTextContent(
        'Operador desconocido',
      )
    })
    expect(screen.getByTestId('operator-chip-unknown')).toBeInTheDocument()
  })

  /* ── PR 8b.6: collapsible SocioNotesCard (notes-collapsible change) ─── */

  it('renders collapsed by default with the counter chip showing the note count', async () => {
    listSocioNotesMock.mockResolvedValueOnce([
      makeNote({ id: 'n-1', body: 'uno' }),
      makeNote({ id: 'n-2', body: 'dos' }),
      makeNote({ id: 'n-3', body: 'tres' }),
    ])
    renderCard()

    await waitFor(() => {
      expect(screen.getByTestId('notes-counter')).toHaveTextContent('3 notas')
    })
    expect(screen.getByTestId('notes-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('notes-toggle')).toHaveAttribute('aria-controls', 'socio-notes-panel')
  })

  it('clicking the toggle flips aria-expanded and writes "false" to localStorage', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByTestId('notes-toggle')).toBeInTheDocument()
    })
    expect(globalThis.localStorage.getItem('notes-collapsed-' + SOCIO_ID)).toBeNull()

    fireEvent.click(screen.getByTestId('notes-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('notes-toggle')).toHaveAttribute('aria-expanded', 'true')
    })
    expect(globalThis.localStorage.getItem('notes-collapsed-' + SOCIO_ID)).toBe('false')
  })
})
