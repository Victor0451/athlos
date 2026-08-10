import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CtacteDebitForm } from './CtacteDebitForm'

/**
 * R4 — server ApiError.details routing into the Débito form fields
 * (athlos-ctacte-mutations). Sibling of CtacteDebitForm.test.tsx so
 * the original test file stays within the design's ≤ 200 LoC cap.
 *
 * The server returns
 *   { error: 'VALIDATION_ERROR', details: [{ field, message }, ...] }
 * for Débito; the form MUST route each entry to react-hook-form's
 * `setError(field, ...)` so the message renders inline. The
 * top-level failure toast MUST still fire. When the server returns
 * no field details, only the toast fires.
 */

const registerCtacteDebitMock = vi.fn()
const notifyMock = vi.fn()
const onSuccessMock = vi.fn()
const onCloseMock = vi.fn()

vi.mock('@/lib/api/ctacte-mutations', () => ({
  registerCtacteDebit: (...args: unknown[]) => registerCtacteDebitMock(...args),
}))

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

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
    <CtacteDebitForm open socioId={SOCIO_ID} onSuccess={onSuccessMock} onClose={onCloseMock} />,
  )
}

async function fillAndSubmit() {
  await act(async () => {
    fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '300' } })
    fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-01-15' } })
    fireEvent.input(screen.getByLabelText(/motivo/i), { target: { value: 'Cargo mora' } })
  })
  await act(async () => {
    fireEvent.submit(document.getElementById('ctacte-debit-form')!)
  })
}

describe('CtacteDebitForm R4 — server ApiError.details routing', () => {
  beforeEach(() => {
    registerCtacteDebitMock.mockReset()
    notifyMock.mockReset()
    onSuccessMock.mockReset()
    onCloseMock.mockReset()
  })

  it('routes a monto field error inline and retains the top-level toast', async () => {
    registerCtacteDebitMock.mockRejectedValueOnce(
      apiErrorWith([{ field: 'monto', message: 'Monto: debe ser mayor a 0' }]),
    )
    renderForm()
    await fillAndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Monto: debe ser mayor a 0')
    })
    expect(screen.getByLabelText(/monto/i)).toHaveAttribute('aria-invalid', 'true')
    expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
    expect(onCloseMock).not.toHaveBeenCalled()
  })

  it('routes a fecha field error inline', async () => {
    registerCtacteDebitMock.mockRejectedValueOnce(
      apiErrorWith([{ field: 'fecha', message: 'Fecha: invalid ISO calendar date' }]),
    )
    renderForm()
    await fillAndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid ISO calendar date/i)
    })
    expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
  })

  it('routes a motivo field error inline', async () => {
    registerCtacteDebitMock.mockRejectedValueOnce(
      apiErrorWith([{ field: 'motivo', message: 'Motivo: server rejected' }]),
    )
    renderForm()
    await fillAndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Motivo: server rejected/i)
    })
    expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
  })

  it('fires only the top-level toast when the server returns no field details', async () => {
    registerCtacteDebitMock.mockRejectedValueOnce({
      name: 'ApiError',
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    } as Error)
    renderForm()
    await fillAndSubmit()
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
