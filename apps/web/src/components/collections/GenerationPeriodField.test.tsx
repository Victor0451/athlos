import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GenerationPeriodField } from './GenerationPeriodField'

describe('GenerationPeriodField', () => {
  it('muestra el período inicial con el mes en español y el año numérico', () => {
    render(<GenerationPeriodField value="2026-09" onChange={vi.fn()} />)

    expect(screen.getByLabelText('Mes')).toHaveValue('09')
    expect(screen.getByLabelText('Año')).toHaveValue('2026')
    expect(screen.getByRole('option', { name: 'septiembre' })).toHaveProperty('selected', true)
    expect(document.querySelector('input[type="month"]')).not.toBeInTheDocument()
  })

  it('informa en español cuando el año no es válido', async () => {
    const user = userEvent.setup()
    const onValidityChange = vi.fn()
    render(
      <GenerationPeriodField
        value="2026-09"
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    )

    await user.clear(screen.getByLabelText('Año'))
    await user.type(screen.getByLabelText('Año'), '27')

    expect(screen.getByRole('alert')).toHaveTextContent('Ingresá un año de cuatro dígitos.')
    expect(onValidityChange).toHaveBeenLastCalledWith(false)
  })
})
