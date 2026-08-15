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
    // Wipe any localStorage state from prior tests so each test starts
    // with a clean cache — the modal persists the idempotency key
    // across reloads and that cross-test contamination would otherwise
    // flip flaky tests.
    window.localStorage.clear()
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

  it('uses the institutional console controls', () => {
    renderForm()
    expect(screen.getByRole('textbox')).toHaveClass(
      'rounded-md',
      'border-ink-200',
      'bg-surface',
      'text-sm',
      'text-ink-700',
      'placeholder:text-ink-300',
      'focus:border-accent',
      'focus:ring-2',
      'focus:ring-accent',
    )
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass(
      'min-h-11',
      'rounded-md',
      'border-ink-200',
      'bg-surface',
      'hover:bg-surface-sunken',
    )
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toHaveClass(
      'min-h-11',
      'rounded-md',
      'bg-accent',
      'text-accent-foreground',
      'hover:bg-accent-hover',
    )
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
    expect(addCtacteNoteMock.mock.calls[0]).toEqual([
      SOCIO_ID,
      MOVEMENT_ID,
      'Llamó el socio.',
      expect.stringMatching(/^.{1,128}$/),
    ])
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
    expect(screen.getByRole('alert')).toHaveClass('text-xs', 'text-danger')
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

  // R3 fix #2 — web layer Idempotency-Key retention on retries.
  // The form MUST generate an opaque Idempotency-Key on first
  // submit and REUSE the SAME key across ambiguous retries of the
  // same intent (a network 5xx on the first attempt MUST replay with
  // the same key, not generate a duplicate). Editing the body must
  // mint a FRESH key so the server recognises a new intent.
  it('forwards one stable Idempotency-Key across ambiguous retries of the same submission', async () => {
    renderForm()
    const textbox = screen.getByRole('textbox')

    // First attempt: simulate a network/5xx failure on the first call.
    addCtacteNoteMock.mockRejectedValueOnce(new Error('boom: network glitch'))

    await act(async () => {
      fireEvent.input(textbox, { target: { value: 'Verificar comprobante físico' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(1)
    })
    const firstCallKey = (addCtacteNoteMock.mock.calls[0] as unknown[])[3] as string
    expect(typeof firstCallKey).toBe('string')
    expect(firstCallKey.length).toBeGreaterThan(0)
    expect(firstCallKey.length).toBeLessThanOrEqual(128)

    // Second attempt: same body, success.
    addCtacteNoteMock.mockResolvedValueOnce({
      id: 'note-2',
      ctacte_movement_id: MOVEMENT_ID,
      body: 'Verificar comprobante físico',
      author_operator_id: 'op-1',
      created_at: '2026-01-15T12:05:00.000Z',
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(2)
    })
    const secondCallKey = (addCtacteNoteMock.mock.calls[1] as unknown[])[3] as string
    expect(secondCallKey).toBe(firstCallKey)
  })

  it('rotates the Idempotency-Key when the user changes the body (new intent)', async () => {
    renderForm()
    const textbox = screen.getByRole('textbox')
    addCtacteNoteMock.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      fireEvent.input(textbox, { target: { value: 'Original intent' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(1)
    })
    const firstKey = (addCtacteNoteMock.mock.calls[0] as unknown[])[3] as string

    // Edit the body to a clearly-different intent.
    addCtacteNoteMock.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      fireEvent.input(textbox, { target: { value: 'Edited intent' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(2)
    })
    const secondKey = (addCtacteNoteMock.mock.calls[1] as unknown[])[3] as string
    expect(secondKey).not.toBe(firstKey)
  })

  // R3 fix batch — defect #3 (reload-safe note retry).
  // The Idempotency-Key MUST survive a page reload so that an
  // interrupted submit (network glitch mid-submit, dev-tools
  // refresh, accidental tab close) does NOT generate a duplicate
  // note on the next mount. The key is pinned per
  // (socioId, movementId, body-hash) in localStorage; a body change
  // mints a fresh key and the success path clears the cache so the
  // form opens clean next time.
  it('persists the Idempotency-Key in localStorage keyed by (socioId, movementId, body) — even after a 5xx', async () => {
    renderForm()
    const textbox = screen.getByRole('textbox')
    // Force a network-style failure so the cache survives — the
    // success path explicitly clears the entry.
    addCtacteNoteMock.mockRejectedValueOnce(new Error('boom: network glitch'))
    await act(async () => {
      fireEvent.input(textbox, { target: { value: 'Reload me' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(1)
    })
    const key = (addCtacteNoteMock.mock.calls[0] as unknown[])[3] as string

    // The form MUST have written the key under a stable localStorage
    // entry that survives process restarts. Reading via a stable
    // (socioId, movementId) key.
    const stored = window.localStorage.getItem(`ctacte-note-idem:${SOCIO_ID}:${MOVEMENT_ID}`)
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored!) as { bodyHash: string; key: string }
    expect(parsed.bodyHash.length).toBeGreaterThan(0)
    expect(parsed.key).toBe(key)
  })

  it('reuses the cached key when the form is remounted for the same body (page reload simulation)', async () => {
    // First instance: type, submit (fails), unmount.
    const first = renderForm()
    const textbox = screen.getByRole('textbox')
    addCtacteNoteMock.mockRejectedValueOnce(new Error('network glitch'))
    await act(async () => {
      fireEvent.input(textbox, { target: { value: 'Survives reload' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(1)
    })
    const firstKey = (addCtacteNoteMock.mock.calls[0] as unknown[])[3] as string
    first.unmount()

    // "Reload": unmount + remount with the same persisted localStorage.
    // A second submit MUST reuse the cached key, not mint a new one.
    addCtacteNoteMock.mockRejectedValueOnce(new Error('still flaky'))
    renderForm() // remount — reads from localStorage
    const textbox2 = screen.getByRole('textbox')
    await act(async () => {
      fireEvent.input(textbox2, { target: { value: 'Survives reload' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(addCtacteNoteMock).toHaveBeenCalledTimes(2)
    })
    const secondKey = (addCtacteNoteMock.mock.calls[1] as unknown[])[3] as string
    expect(secondKey).toBe(firstKey)
  })

  it('clears the cached key after a successful submit (next open starts fresh)', async () => {
    renderForm()
    const textbox = screen.getByRole('textbox')
    addCtacteNoteMock.mockResolvedValueOnce({
      id: 'note-success',
      ctacte_movement_id: MOVEMENT_ID,
      body: 'Will succeed',
      author_operator_id: 'op-1',
      created_at: '2026-01-15T12:15:00.000Z',
    })
    await act(async () => {
      fireEvent.input(textbox, { target: { value: 'Will succeed' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('success', 'Nota agregada')
    })
    // The cached key MUST be cleared so the next open of the modal
    // mints a NEW key (no stale-key 409).
    const stored = window.localStorage.getItem(`ctacte-note-idem:${SOCIO_ID}:${MOVEMENT_ID}`)
    expect(stored).toBeNull()
  })
})
