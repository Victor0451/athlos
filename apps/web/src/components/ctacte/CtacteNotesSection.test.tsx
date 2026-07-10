import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'

/**
 * CtacteNotesSection tests (PR A2 — athlos-ctacte-mutations; R3 updates).
 *
 * Tests:
 *   - default collapsed state
 *   - expand toggles aria-expanded (localStorage persistence keyed by cuenta)
 *   - addCtacteNote called on submit
 *   - OperatorChip renders "username · ROLE"
 *   - loading and request errors are surfaced instead of rendered as empty data
 *   - R3: collapse key uses the cuenta (socioId), not the movementId
 *   - R3: cross-cuenta isolation (different cuentas store state separately)
 *   - R3: delete button gated to author OR ADMIN
 *   - R3: delete button click → deleteCtacteNote + refetch callback
 */

const getOperatorNamesMock = vi.fn()
const addCtacteNoteMock = vi.fn()
const deleteCtacteNoteMock = vi.fn()
const notifyMock = vi.fn((..._args: unknown[]) => 'toast-mock')
const useAuthMock = vi.fn()

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

vi.mock('@/lib/api/operators', () => ({
  OPERATORS_QUERY_KEY: (ids: readonly string[]) => ['operators', ids.join(',')] as const,
  getOperatorNames: (...args: unknown[]) => getOperatorNamesMock(...args),
}))

vi.mock('@/lib/api/ctacte-mutations', () => ({
  addCtacteNote: (...args: unknown[]) => addCtacteNoteMock(...args),
  deleteCtacteNote: (...args: unknown[]) => deleteCtacteNoteMock(...args),
}))

vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { CtacteNotesSection, useNotesCollapsed } = await import('./CtacteNotesSection')

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const OTHER_SOCIO_ID = 'b2c3d4e5-f6a7-8901-bcde-f23456789012'
const MOVEMENT_ID = 'mv-abc123'

const SAMPLE_NOTES = [
  {
    id: 'note-1',
    ctacte_movement_id: MOVEMENT_ID,
    body: 'El socio llamó consultando por el saldo.',
    author_operator_id: 'op-1',
    created_at: '2026-01-15T12:00:00.000Z',
  },
]

function makeAuthUser(
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA',
  operatorId = 'op-self',
) {
  return {
    user: {
      operator_id: operatorId,
      role,
      username: 'self_user',
      permissions: { can_reprint: true, can_anulate: true },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

function renderSection(
  notes = SAMPLE_NOTES,
  {
    isLoading = false,
    error = null,
    socioId = SOCIO_ID,
  }: { isLoading?: boolean; error?: string | null; socioId?: string } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CtacteNotesSection
        socioId={socioId}
        movementId={MOVEMENT_ID}
        notes={notes}
        isLoading={isLoading}
        error={error}
        onNoteAdded={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('CtacteNotesSection', () => {
  beforeEach(() => {
    getOperatorNamesMock.mockReset()
    addCtacteNoteMock.mockReset()
    deleteCtacteNoteMock.mockReset()
    notifyMock.mockReset()
    useAuthMock.mockReset()

    getOperatorNamesMock.mockResolvedValue([
      { id: 'op-1', username: 'juan_operador', role: 'OPERADOR' as const },
    ])
    addCtacteNoteMock.mockResolvedValue({
      id: 'note-new',
      ctacte_movement_id: MOVEMENT_ID,
      body: 'Nueva nota',
      author_operator_id: 'op-1',
      created_at: new Date().toISOString(),
    })
    deleteCtacteNoteMock.mockResolvedValue({ id: 'note-1', deleted: true })

    // Default caller is the note author — exercises the "own note" path
    useAuthMock.mockReturnValue(makeAuthUser('OPERADOR', 'op-1'))

    // Reset localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    })
  })

  it('renders in collapsed state by default', () => {
    renderSection([])
    expect(screen.getByTestId('ctacte-notes-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('ctacte-notes-panel')).not.toBeInTheDocument()
  })

  it('expands when toggle is clicked', async () => {
    const user = userEvent.setup()
    renderSection([])
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-notes-toggle')).toHaveAttribute('aria-expanded', 'true')
    })
    expect(screen.getByTestId('ctacte-notes-panel')).toBeInTheDocument()
  })

  it('shows the new-note form after expanding', async () => {
    const user = userEvent.setup()
    renderSection([])
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-note-new-form')).toBeInTheDocument()
    })
  })

  it('calls addCtacteNote on submit with correct args', async () => {
    const user = userEvent.setup()
    renderSection([])
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-note-new-form')).toBeInTheDocument()
    })
    await user.type(screen.getByTestId('ctacte-note-new-body'), 'El socio llamó.')
    await user.click(screen.getByRole('button', { name: /agregar nota/i }))
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledWith(SOCIO_ID, MOVEMENT_ID, 'El socio llamó.')
    })
  })

  it('renders OperatorChip with "username · ROLE" for each note author', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-note-author-note-1')).toHaveTextContent(
        /juan_operador.*OPERADOR/i,
      )
    })
  })

  it('shows a loading state rather than an empty note list', async () => {
    const user = userEvent.setup()
    renderSection([], { isLoading: true })
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-notes-loading')).toBeInTheDocument()
    })
  })

  it('shows the notes request error rather than masking it as empty data', async () => {
    const user = userEvent.setup()
    renderSection([], { error: 'No pudimos cargar las notas del movimiento.' })
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-notes-error')).toHaveTextContent(/no pudimos cargar/i)
    })
  })

  it('shows empty state when no notes exist', async () => {
    const user = userEvent.setup()
    renderSection([])
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-notes-empty')).toBeInTheDocument()
    })
  })
})

describe('R3 — useNotesCollapsed uses the cuenta key, not the movementId', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    })
  })

  it('persists collapsed state under ctacte-notes-collapsed-<cuentaId>', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem,
    })
    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))
    expect(result.current.collapsed).toBe(true)
    result.current.toggle()
    expect(setItem).toHaveBeenCalledWith(`ctacte-notes-collapsed-${SOCIO_ID}`, 'false')
  })

  it('isolates state across cuentas (no cross-cuenta bleed)', async () => {
    const store = new Map<string, string>([[`ctacte-notes-collapsed-${OTHER_SOCIO_ID}`, 'false']])
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
      }),
    })

    const cuentaA = renderHook(() => useNotesCollapsed(SOCIO_ID, null))
    const cuentaB = renderHook(() => useNotesCollapsed(OTHER_SOCIO_ID, null))

    await waitFor(() => {
      expect(cuentaA.result.current.collapsed).toBe(true)
      expect(cuentaB.result.current.collapsed).toBe(false)
    })
  })

  it('hydrates collapsed=false from localStorage on mount for the cuenta key', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) =>
        key === `ctacte-notes-collapsed-${SOCIO_ID}` ? 'false' : null,
      ),
      setItem: vi.fn(),
    })

    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))

    await waitFor(() => {
      expect(result.current.collapsed).toBe(false)
    })
  })
})

describe('R3 — CtacteNotesSection delete button authorization', () => {
  beforeEach(() => {
    getOperatorNamesMock.mockReset()
    addCtacteNoteMock.mockReset()
    deleteCtacteNoteMock.mockReset()
    notifyMock.mockReset()
    useAuthMock.mockReset()

    getOperatorNamesMock.mockResolvedValue([
      { id: 'op-1', username: 'juan_operador', role: 'OPERADOR' as const },
    ])
    deleteCtacteNoteMock.mockResolvedValue({ id: 'note-1', deleted: true })

    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    })
  })

  it('shows the delete button when the caller is the author of the note', async () => {
    useAuthMock.mockReturnValue(makeAuthUser('OPERADOR', 'op-1'))
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-note-delete-note-1')).toBeInTheDocument()
    })
  })

  it('shows the delete button when the caller is an ADMIN (not the author)', async () => {
    useAuthMock.mockReturnValue(makeAuthUser('ADMIN', 'op-admin'))
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-note-delete-note-1')).toBeInTheDocument()
    })
  })

  it('hides the delete button when the caller is neither author nor ADMIN', async () => {
    useAuthMock.mockReturnValue(makeAuthUser('OPERADOR', 'op-other'))
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-note-author-note-1')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('ctacte-note-delete-note-1')).not.toBeInTheDocument()
  })

  it('clicking delete calls deleteCtacteNote and invokes onNoteAdded to refetch', async () => {
    useAuthMock.mockReturnValue(makeAuthUser('OPERADOR', 'op-1'))
    const onNoteAdded = vi.fn()
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    render(
      <QueryClientProvider client={client}>
        <CtacteNotesSection
          socioId={SOCIO_ID}
          movementId={MOVEMENT_ID}
          notes={SAMPLE_NOTES}
          isLoading={false}
          error={null}
          onNoteAdded={onNoteAdded}
        />
      </QueryClientProvider>,
    )
    await user.click(screen.getByTestId('ctacte-notes-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-note-delete-note-1')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('ctacte-note-delete-note-1'))
    await waitFor(() => {
      expect(deleteCtacteNoteMock).toHaveBeenCalledWith(SOCIO_ID, MOVEMENT_ID, 'note-1')
      expect(onNoteAdded).toHaveBeenCalledTimes(1)
    })
  })
})
