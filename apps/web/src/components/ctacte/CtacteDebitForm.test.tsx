import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CtacteDebitForm } from './CtacteDebitForm'

/**
 * CtacteDebitForm tests (PR A2 — athlos-ctacte-mutations).
 *
 * Tests:
 *   - renders fields + submit success calls registerCtacteDebit + notify('success') + close
 *   - monto <= 0 inline error
 *   - motivo empty inline error
 *   - vi.mock synchronous factory for api functions
 *
 * The Modal is tested in isolation in `Modal.test.tsx`; here we test
 * the form logic + integration with registerCtacteDebit + notify.
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

function renderForm(open = true) {
  return render(
    <CtacteDebitForm
      open={open}
      socioId={SOCIO_ID}
      onSuccess={onSuccessMock}
      onClose={onCloseMock}
    />,
  )
}

describe('CtacteDebitForm', () => {
  beforeEach(() => {
    registerCtacteDebitMock.mockReset()
    notifyMock.mockReset()
    onSuccessMock.mockReset()
    onCloseMock.mockReset()
    registerCtacteDebitMock.mockResolvedValue({
      id: 'mv-debit-1',
      tipo: 'DEBITO' as const,
      monto: '300.00',
      fecha: '2026-01-15',
      motivo: 'Cargo por mora',
    })
  })

  it('renders monto, fecha, and motivo fields when open', () => {
    renderForm()
    expect(screen.getByLabelText(/monto/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fecha/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/motivo/i)).toBeInTheDocument()
  })

  it('calls registerCtacteDebit with correct args on successful submit', async () => {
    renderForm()
    await act(async () => {
      fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '300' } })
      fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-01-15' } })
      fireEvent.input(screen.getByLabelText(/motivo/i), { target: { value: 'Cargo por mora' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-debit-form')!)
    })
    await waitFor(() => {
      expect(registerCtacteDebitMock).toHaveBeenCalledTimes(1)
    })
    expect(registerCtacteDebitMock).toHaveBeenCalledWith(SOCIO_ID, {
      monto: 300,
      fecha: '2026-01-15',
      motivo: 'Cargo por mora',
      idempotencyKey: expect.any(String),
    })
  })

  it('calls notify("success") and onClose on successful submit', async () => {
    renderForm()
    await act(async () => {
      fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '300' } })
      fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-01-15' } })
      fireEvent.input(screen.getByLabelText(/motivo/i), { target: { value: 'Cargo por mora' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-debit-form')!)
    })
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('success', 'Débito registrado')
    })
    expect(onSuccessMock).toHaveBeenCalledTimes(1)
    expect(onCloseMock).toHaveBeenCalledTimes(1)
  })

  it('calls notify("error") and does NOT close on network failure', async () => {
    registerCtacteDebitMock.mockRejectedValueOnce(new Error('Network error'))
    renderForm()
    await act(async () => {
      fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '300' } })
      fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-01-15' } })
      fireEvent.input(screen.getByLabelText(/motivo/i), { target: { value: 'Cargo por mora' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-debit-form')!)
    })
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith(
        'error',
        'No se pudo registrar el débito. Intentá de nuevo.',
      )
    })
    expect(onCloseMock).not.toHaveBeenCalled()
  })

  it('shows inline error when monto is 0 or negative', async () => {
    renderForm()
    await act(async () => {
      fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '0' } })
      fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-01-15' } })
      fireEvent.input(screen.getByLabelText(/motivo/i), { target: { value: 'Cargo por mora' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-debit-form')!)
    })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/monto/i)
    })
    expect(registerCtacteDebitMock).not.toHaveBeenCalled()
  })

  it('shows inline error when motivo is empty', async () => {
    renderForm()
    await act(async () => {
      fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '300' } })
      fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-01-15' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-debit-form')!)
    })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/motivo/i)
    })
    expect(registerCtacteDebitMock).not.toHaveBeenCalled()
  })

  it('renders nothing when open is false', () => {
    const { container } = renderForm(false)
    expect(container).toBeEmptyDOMElement()
  })
})
