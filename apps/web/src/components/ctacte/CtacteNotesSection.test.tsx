import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'

/**
 * CtacteNotesSection tests (PR A2 — athlos-ctacte-mutations).
 *
 * Tests:
 *   - default collapsed state
 *   - expand toggles aria-expanded (localStorage persistence)
 *   - addCtacteNote called on submit
 *   - OperatorChip renders "username · ROLE"
 *   - loading and request errors are surfaced instead of rendered as empty data
 */

const getOperatorNamesMock = vi.fn()
const addCtacteNoteMock = vi.fn()
const notifyMock = vi.fn((..._args: unknown[]) => 'toast-mock')

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

vi.mock('@/lib/api/operators', () => ({
  OPERATORS_QUERY_KEY: (ids: readonly string[]) => ['operators', ids.join(',')] as const,
  getOperatorNames: (...args: unknown[]) => getOperatorNamesMock(...args),
}))

vi.mock('@/lib/api/ctacte-mutations', () => ({
  addCtacteNote: (...args: unknown[]) => addCtacteNoteMock(...args),
}))

const { CtacteNotesSection } = await import('./CtacteNotesSection')

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
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

function renderSection(
  notes = SAMPLE_NOTES,
  { isLoading = false, error = null }: { isLoading?: boolean; error?: string | null } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CtacteNotesSection
        socioId={SOCIO_ID}
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
    notifyMock.mockReset()

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
