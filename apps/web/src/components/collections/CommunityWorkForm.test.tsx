import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommunityWorkForm } from './CommunityWorkForm'

describe('CommunityWorkForm', () => {
  // prettier-ignore
  const renderForm = (overrides: Partial<React.ComponentProps<typeof CommunityWorkForm>> = {}) => render(<CommunityWorkForm open busy={false} onCancel={vi.fn()} onSubmit={vi.fn()} {...overrides} />)

  it('requires a positive approved value, evidence, and reason with accessible validation', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      /valor aprobado, la evidencia y el motivo son obligatorios/i,
    )
    expect(screen.getByLabelText(/valor aprobado/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/evidencia/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/motivo/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('submits a positive approved value and non-empty evidence and reason', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.type(screen.getByLabelText(/valor aprobado/i), '2500')
    await user.type(screen.getByLabelText(/evidencia/i), 'Acta 12 aprobada')
    await user.type(screen.getByLabelText(/motivo/i), 'Trabajo aceptado por el club')
    await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      amountCents: 2500,
      evidence: 'Acta 12 aprobada',
      reason: 'Trabajo aceptado por el club',
    })
  })

  it('keeps the evidence draft when the container reports a conflict', async () => {
    const user = userEvent.setup()
    renderForm({ error: 'El saldo cambió. Revisá la deuda antes de reintentar.' })

    const evidence = screen.getByLabelText(/evidencia/i)
    await user.type(evidence, 'Borrador de evidencia')

    expect(screen.getByRole('alert')).toHaveTextContent(/saldo cambió/i)
    expect(evidence).toHaveValue('Borrador de evidencia')
  })

  it('announces form guidance as a polite status and disables confirmation while busy', () => {
    renderForm({ busy: true })

    expect(screen.getByRole('status')).toHaveTextContent(/deuda.*solo.*confirm/i)
    expect(screen.getByRole('button', { name: /confirmando trabajo comunitario/i })).toBeDisabled()
  })
})
