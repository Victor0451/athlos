import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TreatmentWorkspace } from './TreatmentWorkspace'
import type { DebtDetail } from './DebtPanel'

const debt = {
  status: 'ready',
  socio_id: 'socio-1',
  currency: 'ARS',
  total_debt_cents: 10_000,
  obligations: [
    {
      id: 'obligation-1',
      period_start: '2026-01-01',
      period_end: '2026-02-01',
      original_amount_cents: 10_000,
      outstanding_cents: 10_000,
      currency: 'ARS',
      status: 'OPEN',
      components: [],
      benefits: [],
      allocations: [],
    },
  ],
} satisfies DebtDetail

describe('TreatmentWorkspace', () => {
  it('presents four labelled treatments without payment controls for an operator', () => {
    render(
      <TreatmentWorkspace
        memberId="socio-1"
        debt={debt}
        role="OPERADOR"
        agreementsEnabled
        agreementStates={{}}
        onCreateAgreement={vi.fn()}
        onRefreshAgreement={vi.fn()}
        onRequestCondonation={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: /tratamientos de deuda/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pago' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trabajo comunitario' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Acuerdo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Condonación' })).toBeInTheDocument()
    expect(screen.getByText(/mediante una liquidación/i)).toBeInTheDocument()
    expect(screen.getByText(/comando aceptado/i)).toBeInTheDocument()
    expect(screen.getByText(/no reduce la deuda/i)).toBeInTheDocument()
    expect(screen.getByText(/ejecución aprobada/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /registrar pago/i })).not.toBeInTheDocument()
  })
})
