import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PricingForm } from './PricingForm'

describe('PricingForm', () => {
  it('uses accessible Spanish text inputs instead of browser date widgets', () => {
    render(<PricingForm disciplines={[]} onCreate={vi.fn()} />)

    for (const label of ['Vigente desde', 'Vigente hasta']) {
      const input = screen.getByLabelText(label)
      expect(input).toHaveAttribute('type', 'text')
      expect(input).toHaveAttribute('inputmode', 'numeric')
      expect(input).toHaveAttribute('autocomplete', 'off')
      expect(input).toHaveAttribute('placeholder', 'DD/MM/AAAA')
      expect(input).toHaveAttribute('aria-describedby')
    }
    expect(screen.getAllByText('Formato: DD/MM/AAAA')).toHaveLength(2)
    expect(document.querySelector('input[type="date"]')).toBeNull()
    expect(screen.queryByPlaceholderText(/mm\/dd\/yyyy/i)).not.toBeInTheDocument()
  })

  it('rejects invalid dates and dates ending before they start without calling the API', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<PricingForm disciplines={[]} onCreate={onCreate} />)

    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '125')
    await user.type(screen.getByLabelText('Vigente desde'), '31/04/2026')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/fecha válida/i)
    expect(onCreate).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Vigente desde'))
    await user.type(screen.getByLabelText('Vigente desde'), '02/05/2026')
    await user.type(screen.getByLabelText('Vigente hasta'), '01/05/2026')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/no puede ser anterior/i)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('retains its draft after a rejected create handoff', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue(new Error('conflict'))
    render(<PricingForm disciplines={[]} onCreate={onCreate} />)

    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '125')
    await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(screen.getByLabelText('Importe mensual (ARS)')).toHaveValue('125')
    expect(screen.getByLabelText('Vigente desde')).toHaveValue('01/01/2026')
  })

  it('requires a discipline for a sport addition', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <PricingForm
        disciplines={[{ id: 'disciplina-1', codigo: 'NATACION', nombre: 'Natación' }]}
        onCreate={onCreate}
      />,
    )

    await user.selectOptions(screen.getByLabelText('Tipo de cuota'), 'SPORT')
    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '35')
    await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('submits the selected discipline id for a sport addition', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <PricingForm
        disciplines={[{ id: 'disciplina-1', codigo: 'NATACION', nombre: 'Natación' }]}
        onCreate={onCreate}
      />,
    )

    await user.selectOptions(screen.getByLabelText('Tipo de cuota'), 'SPORT')
    await user.selectOptions(screen.getByLabelText('Disciplina'), 'disciplina-1')
    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '35')
    await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
    await user.selectOptions(screen.getByLabelText('Regla de cálculo'), 'NEXT_PERIOD')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'SPORT',
        disciplina_id: 'disciplina-1',
        effective_from: '2026-01-01',
        rule: 'NEXT_PERIOD',
      }),
    )
  })

  it('submits ARS major units and comma decimals as cents', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<PricingForm disciplines={[]} onCreate={onCreate} />)

    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '10000,25')
    await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_cents: 1_000_025,
        kind: 'BASE',
        disciplina_id: null,
        effective_from: '2026-01-01',
      }),
    )
  })

  it.each(['0', '-1', '10,999', 'importe'])(
    'rejects invalid non-positive ARS input %s',
    async (amount) => {
      const user = userEvent.setup()
      const onCreate = vi.fn()
      render(<PricingForm disciplines={[]} onCreate={onCreate} />)

      await user.type(screen.getByLabelText('Importe mensual (ARS)'), amount)
      await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
      await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

      expect(screen.getByRole('alert')).toHaveTextContent(/importe positivo/i)
      expect(onCreate).not.toHaveBeenCalled()
    },
  )

  it('disables submission while busy', () => {
    render(<PricingForm busy disciplines={[]} onCreate={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Guardar cuota' })).toBeDisabled()
  })
})
