import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CtactePaymentForm } from './CtactePaymentForm'

/**
 * R4 — server ApiError.details routing into the Pago form fields
 * (athlos-ctacte-mutations). Sibling of CtactePaymentForm.test.tsx so
 * the original test file stays within the design's ≤ 200 LoC cap.
 *
 * The server returns
 *   { error: 'VALIDATION_ERROR', details: [{ field, message }, ...] }
 * for Pago; the form MUST route each entry to react-hook-form's
 * `setError(field, ...)` so the message renders inline (under the
 * matching input). The top-level failure toast MUST still fire so
 * the operator sees both surfaces — per R4's "retain top-level
 * failure toast" requirement. When the server returns no field
 * details (e.g. a 500 INTERNAL_ERROR), ONLY the toast fires — no
 * inline error.
 */

const registerCtactePaymentMock = vi.fn()
const notifyMock = vi.fn()
const onSuccessMock = vi.fn()
const onCloseMock = vi.fn()

vi.mock('@/lib/api/ctacte-mutations', () => ({
  registerCtactePayment: (...args: unknown[]) => registerCtactePaymentMock(...args),
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
    <CtactePaymentForm open socioId={SOCIO_ID} onSuccess={onSuccessMock} onClose={onCloseMock} />,
  )
}

async function fillAndSubmit() {
  await act(async () => {
    fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '1500' } })
    fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-01-15' } })
    fireEvent.input(screen.getByLabelText(/concepto/i), { target: { value: 'Pago cuota' } })
  })
  await act(async () => {
    fireEvent.submit(document.getElementById('ctacte-payment-form')!)
  })
}

describe('CtactePaymentForm R4 — server ApiError.details routing', () => {
  beforeEach(() => {
    registerCtactePaymentMock.mockReset()
    notifyMock.mockReset()
    onSuccessMock.mockReset()
    onCloseMock.mockReset()
  })

  it('routes a monto field error inline and retains the top-level toast', async () => {
    registerCtactePaymentMock.mockRejectedValueOnce(
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

  it('routes a fecha field error inline (outside socio relationship range)', async () => {
    registerCtactePaymentMock.mockRejectedValueOnce(
      apiErrorWith([{ field: 'fecha', message: "outside socio's relationship range" }]),
    )
    renderForm()
    await fillAndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/outside socio's relationship range/i)
    })
    expect(screen.getByLabelText(/fecha/i)).toHaveAttribute('aria-invalid', 'true')
    expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
    expect(onCloseMock).not.toHaveBeenCalled()
  })

  it('routes a concepto field error inline', async () => {
    registerCtactePaymentMock.mockRejectedValueOnce(
      apiErrorWith([
        { field: 'concepto', message: 'Concepto: no puede superar los 500 caracteres' },
      ]),
    )
    renderForm()
    await fillAndSubmit()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /concepto: no puede superar los 500 caracteres/i,
      )
    })
    expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
  })

  it('fires only the top-level toast when the server returns no field details', async () => {
    registerCtactePaymentMock.mockRejectedValueOnce({
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
    // No inline error when the server didn't provide field details.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onCloseMock).not.toHaveBeenCalled()
  })
})
