import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CtacteNoteForm } from './CtacteNoteForm'

/**
 * CtacteNoteForm tests (PR A2 — athlos-ctacte-mutations).
 *
 * Tests:
 *   - renders textarea + submit success calls addCtacteNote(socioId, movementId, body)
 *   - notify("success") + close on success
 *   - empty body inline error
 *   - body > 2000 inline error
 *   - vi.mock synchronous factory
 */

const addCtacteNoteMock = vi.fn()
const notifyMock = vi.fn()
const onSuccessMock = vi.fn()
const onCloseMock = vi.fn()

vi.mock('@/lib/api/ctacte-mutations', () => ({
  addCtacteNote: (...args: unknown[]) => addCtacteNoteMock(...args),
}))

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const MOVEMENT_ID = 'mv-abc123'

function renderForm(open = true) {
  return render(
    <CtacteNoteForm
      open={open}
      socioId={SOCIO_ID}
      movementId={MOVEMENT_ID}
      onSuccess={onSuccessMock}
      onClose={onCloseMock}
    />,
  )
}

describe('CtacteNoteForm', () => {
  beforeEach(() => {
    addCtacteNoteMock.mockReset()
    notifyMock.mockReset()
    onSuccessMock.mockReset()
    onCloseMock.mockReset()
    addCtacteNoteMock.mockResolvedValue({
      id: 'note-1',
      ctacte_movement_id: MOVEMENT_ID,
      body: 'Llamó el socio.',
      author_operator_id: 'op-1',
      created_at: '2026-01-15T12:00:00.000Z',
    })
  })

  it('renders the textarea when open', () => {
    renderForm()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls addCtacteNote with correct args on successful submit', async () => {
    renderForm()
    await act(async () => {
      fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Llamó el socio.' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(1)
    })
    expect(addCtacteNoteMock).toHaveBeenCalledWith(SOCIO_ID, MOVEMENT_ID, 'Llamó el socio.')
  })

  it('calls notify("success") and onClose on successful submit', async () => {
    renderForm()
    await act(async () => {
      fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Llamó el socio.' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('success', 'Nota agregada')
    })
    expect(onSuccessMock).toHaveBeenCalledTimes(1)
    expect(onCloseMock).toHaveBeenCalledTimes(1)
  })

  it('shows inline error when body is empty', async () => {
    renderForm()
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/vacía/i)
    })
    expect(addCtacteNoteMock).not.toHaveBeenCalled()
  })

  it('shows inline error when body exceeds 2000 characters', async () => {
    renderForm()
    const longBody = 'a'.repeat(2001)
    await act(async () => {
      fireEvent.input(screen.getByRole('textbox'), { target: { value: longBody } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/2000/i)
    })
    expect(addCtacteNoteMock).not.toHaveBeenCalled()
  })

  it('renders nothing when open is false', () => {
    const { container } = renderForm(false)
    expect(container).toBeEmptyDOMElement()
  })
})
