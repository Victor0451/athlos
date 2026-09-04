import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DuesGenerationPlan, DuesGenerationResult } from '@/lib/api/dues'
import { GenerationPanel } from './GenerationPanel'

const plan: DuesGenerationPlan = {
  period: '2026-04',
  currency: 'ARS',
  plan_fingerprint: 'a'.repeat(64),
  can_generate: true,
  configurations: [
    {
      label: 'Cuota social',
      amount_cents: 125000,
      rule: 'Mes completo',
      validity: 'Desde abril de 2026',
    },
  ],
  summary: {
    eligible_count: 3,
    ready_count: 2,
    new_count: 2,
    existing_count: 1,
    review_count: 1,
    conflict_count: 0,
    estimated_new_total_cents: 250000,
  },
  members: [
    {
      member_number: '0042',
      name: 'Ana Pérez',
      status: 'REVIEW',
      gross_cents: 125000,
      net_cents: 120000,
      configuration_labels: ['Cuota social'],
      summary: 'Se aplicó una bonificación.',
      details: ['Cuota social: $ 1.250,00'],
    },
  ],
}
const result: DuesGenerationResult = {
  period: '2026-04',
  generated_obligation_count: 2,
  retained_existing_count: 1,
  review_count: 1,
  generated_total_cents: 250000,
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof GenerationPanel>> = {}) {
  const props = { onPlan: vi.fn(), onGenerate: vi.fn(), onGoToCollections: vi.fn(), ...overrides }
  return { ...render(<GenerationPanel {...props} />), props }
}

describe('GenerationPanel', () => {
  it('muestra el período inicial en español sin un control mensual nativo', () => {
    renderPanel({ period: '2026-09' })

    expect(screen.getByLabelText('Mes')).toHaveValue('09')
    expect(screen.getByRole('option', { name: 'septiembre' })).toHaveProperty('selected', true)
    expect(screen.getByLabelText('Año')).toHaveValue('2026')
    expect(document.querySelector('input[type="month"]')).not.toBeInTheDocument()
  })

  it('revisa el período seleccionado sin generar deudas', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ period: '2026-09' })
    await user.selectOptions(screen.getByLabelText('Mes'), '02')
    await user.clear(screen.getByLabelText('Año'))
    await user.type(screen.getByLabelText('Año'), '2027')
    await user.click(screen.getByRole('button', { name: 'Revisar generación' }))

    expect(props.onPlan).toHaveBeenCalledWith('2027-02')
    expect(props.onGenerate).not.toHaveBeenCalled()
  })

  it('deshabilita la revisión con un año inválido y explica el motivo en español', async () => {
    const user = userEvent.setup()
    renderPanel({ period: '2026-09' })
    await user.clear(screen.getByLabelText('Año'))
    await user.type(screen.getByLabelText('Año'), '27')

    expect(screen.getByRole('button', { name: 'Revisar generación' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresá un año de cuatro dígitos.')
  })

  it('confirms an eligible plan through the parent callback without rendering its fingerprint', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ plan, status: 'ready' })
    await user.click(screen.getByRole('button', { name: 'Confirmar generación' }))

    expect(props.onGenerate).toHaveBeenCalledWith({
      period: '2026-04',
      plan_fingerprint: plan.plan_fingerprint,
    })
    expect(screen.queryByText(plan.plan_fingerprint)).not.toBeInTheDocument()
  })

  it('shows a refreshed stale plan without automatic execution', () => {
    const { props } = renderPanel({ plan, status: 'stale' })

    expect(screen.getByRole('alert')).toHaveTextContent(/datos cambiaron/i)
    expect(screen.getByRole('button', { name: 'Confirmar generación' })).toBeInTheDocument()
    expect(props.onGenerate).not.toHaveBeenCalled()
  })

  it('announces generated totals and offers navigation to collections', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ result, status: 'generated' })
    expect(screen.getByRole('status')).toHaveTextContent(/2 deudas/i)
    expect(screen.getByText(/ARS\s?\$?\s?2\.500,00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ir a cobranza' }))
    expect(props.onGoToCollections).toHaveBeenCalledOnce()
  })

  it('uses live status and alert feedback for loading and errors', () => {
    const { rerender } = renderPanel({ status: 'planning' })
    expect(screen.getByRole('status')).toHaveTextContent(/revisando/i)
    rerender(
      <GenerationPanel
        onPlan={vi.fn()}
        onGenerate={vi.fn()}
        onGoToCollections={vi.fn()}
        status="error"
        error="Error exacto"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Error exacto')
  })
})
