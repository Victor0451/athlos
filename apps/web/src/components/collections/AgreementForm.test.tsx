import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgreementForm } from './AgreementForm'

describe('AgreementForm', () => {
  it('validates Spanish narrative and reason and explains that debt is unchanged', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AgreementForm open busy={false} onCancel={vi.fn()} onSubmit={onSubmit} />)

    expect(screen.getByText(/guardar el acuerdo no reduce la deuda/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /guardar acuerdo/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/narrativa.*motivo/i)
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/narrativa del acuerdo/i), 'Se acuerda una colaboración')
    await user.type(screen.getByLabelText(/motivo del acuerdo/i), 'Situación económica')
    await user.click(screen.getByRole('button', { name: /guardar acuerdo/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      narrative: 'Se acuerda una colaboración',
      reason: 'Situación económica',
    })
  })

  it('validates and submits a revision with a distinct Spanish reason label', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <AgreementForm open busy={false} mode="revision" onCancel={vi.fn()} onSubmit={onSubmit} />,
    )

    await user.click(screen.getByRole('button', { name: /actualizar acuerdo/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/narrativa.*motivo de la revisión/i)
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/narrativa del acuerdo/i), 'Narrativa revisada')
    await user.type(screen.getByLabelText(/motivo de la revisión/i), 'Nueva condición')
    await user.click(screen.getByRole('button', { name: /actualizar acuerdo/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      narrative: 'Narrativa revisada',
      reason: 'Nueva condición',
    })
  })

  it('keeps a supplied API error accessible without clearing the draft', async () => {
    const user = userEvent.setup()
    render(
      <AgreementForm
        open
        busy={false}
        error="No se pudo guardar el acuerdo."
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    const narrative = screen.getByLabelText(/narrativa del acuerdo/i)
    await user.type(narrative, 'Borrador conservado')
    expect(screen.getByRole('alert')).toHaveTextContent(/no se pudo guardar/i)
    expect(narrative).toHaveValue('Borrador conservado')
  })
})
