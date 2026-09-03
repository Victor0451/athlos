import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PricingPanel } from './PricingPanel'

describe('PricingPanel', () => {
  it('identifies base and additional fees beneath its parent configuration dialog', () => {
    render(<PricingPanel prices={[]} onCreate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Cuota base y adicionales' })).toBeInTheDocument()
  })

  it.each([
    ['empty', 'No hay cuotas configuradas.'],
    ['unavailable', 'La configuración de cuotas no está disponible.'],
    ['success', 'Cuota guardada.'],
  ] as const)('renders the pricing %s state', (state, message) => {
    render(<PricingPanel prices={[]} state={state} onCreate={vi.fn()} />)

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it.each([
    ['loading', 'Cargando disciplinas…'],
    ['empty', 'No hay disciplinas disponibles.'],
    ['error', 'No se pudieron cargar las disciplinas.'],
  ] as const)('renders the discipline %s state in Spanish', (disciplineState, message) => {
    render(
      <PricingPanel
        prices={[]}
        disciplines={[]}
        disciplineState={disciplineState}
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('presents configured date ranges without leaking internal values and revokes by id', async () => {
    const user = userEvent.setup()
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    render(
      <PricingPanel
        prices={[
          {
            id: '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d1',
            kind: 'BASE',
            disciplina_id: null,
            amount_cents: 10_000,
            currency: 'ARS',
            effective_from: '2026-09-01',
            effective_to: null,
            rule: 'FULL_MONTH',
            revoked_at: null,
          },
          {
            id: '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d2',
            kind: 'SPORT',
            disciplina_id: '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d3',
            amount_cents: 5_000,
            currency: 'ARS',
            effective_from: '2026-09-01',
            effective_to: '2026-09-30',
            rule: 'NEXT_PERIOD',
            revoked_at: null,
          },
        ]}
        disciplines={[
          {
            id: '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d3',
            codigo: 'NATACION',
            nombre: 'Natación',
          },
        ]}
        onCreate={vi.fn()}
        onRevoke={onRevoke}
      />,
    )

    const configuredPrices = screen.getByRole('list', { name: 'Cuotas configuradas' })
    expect(configuredPrices).toHaveTextContent('Desde el 1 de septiembre de 2026')
    expect(configuredPrices).toHaveTextContent('hasta el 30 de septiembre de 2026')
    for (const internalValue of [
      '2026-09-01',
      '2026-09-30',
      'BASE',
      'SPORT',
      'FULL_MONTH',
      'NEXT_PERIOD',
      '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d1',
      '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d2',
      '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d3',
    ]) {
      expect(configuredPrices).not.toHaveTextContent(internalValue)
    }

    await user.type(screen.getByLabelText('Motivo de baja'), 'Actualización de cuota')
    await user.click(screen.getAllByRole('button', { name: 'Dar de baja cuota' })[1]!)

    expect(onRevoke).toHaveBeenCalledWith(
      '018f8e5e-3f93-7e4a-bc8f-8b3c3a46e8d2',
      'Actualización de cuota',
    )
  })
})
