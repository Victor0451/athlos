import { act, render, screen } from '@testing-library/react'
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

  it.each([
    ['25,50', '25,50', 2550],
    ['25.50', '25,50', 2550],
    ['0.29', '0,29', 29],
    ['15600', '15.600,00', 1560000],
  ])(
    'formats %s pesos on blur without changing exact cents',
    async (amount, formatted, amountCents) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      renderForm({ onSubmit })

      const input = screen.getByLabelText(/valor aprobado/i)
      await user.type(input, amount)
      await user.tab()
      expect(input).toHaveValue(formatted)
      await user.click(input)
      expect(input).toHaveValue(amount)
      await user.tab()
      await user.type(screen.getByLabelText(/evidencia/i), 'Acta 12 aprobada')
      await user.type(screen.getByLabelText(/motivo/i), 'Trabajo aceptado por el club')
      await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i }))

      expect(onSubmit).toHaveBeenCalledWith({
        amountCents,
        evidence: 'Acta 12 aprobada',
        reason: 'Trabajo aceptado por el club',
      })
    },
  )

  it.each(['0', '-1', '1e2', '1,234.00', '1.234', '90071992547409.92'])(
    'rejects malformed or unsafe peso input %s',
    async (amount) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      renderForm({ onSubmit })

      const input = screen.getByLabelText(/valor aprobado/i)
      await user.type(input, amount)
      await user.tab()
      expect(input).toHaveValue(amount)
      await user.type(screen.getByLabelText(/evidencia/i), 'Acta 12 aprobada')
      await user.type(screen.getByLabelText(/motivo/i), 'Trabajo aceptado por el club')
      await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i }))

      expect(screen.getByRole('alert')).toHaveTextContent(/valor aprobado/i)
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it('keeps the evidence draft when the container reports a conflict', async () => {
    const user = userEvent.setup()
    renderForm({ error: 'El saldo cambió. Revisá la deuda antes de reintentar.' })

    const evidence = screen.getByLabelText(/evidencia/i)
    await user.type(evidence, 'Borrador de evidencia')

    expect(screen.getByRole('alert')).toHaveTextContent(/saldo cambió/i)
    expect(evidence).toHaveValue('Borrador de evidencia')
  })

  it('announces form guidance as a polite status and disables confirmation while busy', async () => {
    await act(async () => {
      renderForm({ busy: true })
    })

    expect(screen.getByRole('status')).toHaveTextContent(/deuda.*solo.*confirm/i)
    expect(screen.getByRole('button', { name: /confirmando trabajo comunitario/i })).toBeDisabled()
  })

  it('keeps acceptance gated and its responsive field contract stable', async () => {
    await act(async () => {
      renderForm({ formId: 'accepted-work' })
    })

    expect(screen.getByRole('status')).toHaveTextContent(/solo después de confirmar/i)
    expect(screen.getByRole('button', { name: 'Confirmar trabajo comunitario' })).toHaveAttribute(
      'form',
      'accepted-work',
    )
    expect(screen.getByLabelText(/valor aprobado/i)).toHaveAttribute('inputmode', 'decimal')
    expect(screen.getByText(/usá coma o punto decimal/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/valor aprobado/i)).toHaveClass(
      'min-h-11',
      'font-mono',
      'tabular-nums',
    )
    expect(screen.getByLabelText(/valor aprobado/i).parentElement?.parentElement).toHaveClass(
      'sm:grid-cols-2',
    )
  })
})
