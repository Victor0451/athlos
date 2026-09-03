import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DuesGenerationPlan } from '@/lib/api/dues'
import { GenerationPlanReview } from './GenerationPlanReview'

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

describe('GenerationPlanReview', () => {
  it('renders the applied configuration, summary, translated member details, and no technical leaks', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<GenerationPlanReview plan={plan} isGenerating={false} onConfirm={onConfirm} />)

    expect(screen.getByText('Cuota social')).toBeInTheDocument()
    expect(screen.getByText('Mes completo')).toBeInTheDocument()
    expect(screen.getByText('Desde abril de 2026')).toBeInTheDocument()
    expect(screen.getByText(/ARS\s?\$?\s?2\.500,00/)).toBeInTheDocument()
    expect(screen.getByLabelText('Resumen de generación')).toBeInTheDocument()
    await user.click(screen.getByText('Ver resultados'))
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText('Socio Nº 0042')).toBeInTheDocument()
    expect(screen.getByText('Requiere revisión')).toBeInTheDocument()
    expect(screen.queryByText(plan.plan_fingerprint)).not.toBeInTheDocument()
    expect(screen.queryByText('REVIEW')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar generación' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('disables confirmation and explains ineligible or conflicting plans', () => {
    const { rerender } = render(
      <GenerationPlanReview
        plan={{ ...plan, can_generate: false }}
        isGenerating={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Confirmar generación' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Este plan no puede confirmarse.')

    rerender(
      <GenerationPlanReview
        plan={{ ...plan, summary: { ...plan.summary, conflict_count: 1 } }}
        isGenerating={false}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/conflicto/i)
  })
})
