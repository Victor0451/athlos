import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CtacteNoteForm } from './CtacteNoteForm'

/**
 * R4 — server ApiError.details routing into the Nota form
 * (athlos-ctacte-mutations). Sibling of CtacteNoteForm.test.tsx so
 * the original test file stays within the design's ≤ 200 LoC cap.
 *
 * The server returns
 *   { error: 'VALIDATION_ERROR', details: [{ field: 'body', ... }] }
 * for the nota POST; the form MUST route it to the textarea. The
 * top-level failure toast MUST still fire.
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

function apiErrorWith(details: unknown) {
  return {
    name: 'ApiError',
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Request validation failed',
    details,
  } as Error
}

function renderForm() {
  return render(
    <CtacteNoteForm
      open
      socioId={SOCIO_ID}
      movementId={MOVEMENT_ID}
      onSuccess={onSuccessMock}
      onClose={onCloseMock}
    />,
  )
}

async function fillAndSubmit(body: string) {
  await act(async () => {
    fireEvent.input(screen.getByRole('textbox'), { target: { value: body } })
  })
  await act(async () => {
    fireEvent.submit(document.getElementById('ctacte-note-form')!)
  })
}

describe('CtacteNoteForm R4 — server ApiError.details routing', () => {
  beforeEach(() => {
    addCtacteNoteMock.mockReset()
    notifyMock.mockReset()
    onSuccessMock.mockReset()
    onCloseMock.mockReset()
    window.localStorage.clear()
  })

  it('routes a body field error inline and retains the top-level toast', async () => {
    addCtacteNoteMock.mockRejectedValueOnce(
      apiErrorWith([{ field: 'body', message: 'Body: required, non-empty' }]),
    )
    renderForm()
    await fillAndSubmit('Llamó el socio')
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Body: required, non-empty/i)
    })
    expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
    expect(onCloseMock).not.toHaveBeenCalled()
  })

  it('fires only the top-level toast when the server returns no field details', async () => {
    addCtacteNoteMock.mockRejectedValueOnce({
      name: 'ApiError',
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    } as Error)
    renderForm()
    await fillAndSubmit('Llamó el socio')
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
