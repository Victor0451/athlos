import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DebtPanel, type DebtDetail } from './DebtPanel'

const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
// prettier-ignore
const debt = { status:'ready', socio_id:'socio-1', currency:'ARS', total_debt_cents:10_000, obligations:[{ id:'obligation-1', period_start:'2026-01-01', period_end:'2026-02-01', original_amount_cents:12_500, outstanding_cents:10_000, currency:'ARS', status:'OPEN', components:[{id:'component-1',kind:'BASE',component_key:'base',amount_cents:12_500},{id:'component-2',kind:'BENEFIT',component_key:'benefit-1',amount_cents:-2_500}], benefits:[{id:'component-2',component_key:'benefit-1',amount_cents:-2_500}], allocations:[{id:'allocation-1',settlement_id:'settlement-1',settlement_kind:'MONETARY',settlement_amount_cents:2_500,currency:'ARS',amount_cents:2_500,kind:'ALLOCATION',compensates_allocation_id:null,reversal_eligible:true}] }] } as DebtDetail

describe('DebtPanel', () => {
  it('renders an explicit no-debt state for the selected socio', () => {
    render(
      <DebtPanel
        socio={socio}
        status="empty"
        debt={{ ...debt, status: 'empty', total_debt_cents: 0, obligations: [] }}
        error=""
        onSearch={vi.fn()}
        onSelectSocio={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/no debt/i)
    expect(screen.getByRole('heading', { name: /debt explanation/i })).toBeInTheDocument()
  })

  it('announces an unavailable read as an alert', () => {
    render(
      <DebtPanel
        socio={socio}
        status="unavailable"
        debt={null}
        error="Debt detail is unavailable."
        onSearch={vi.fn()}
        onSelectSocio={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/i)
    expect(screen.getByRole('alert')).toHaveFocus()
  })

  it('renders labelled responsive obligation cards with history and no raw evidence', () => {
    render(
      <DebtPanel
        socio={socio}
        status="ready"
        debt={debt}
        error=""
        onSearch={vi.fn()}
        onSelectSocio={vi.fn()}
      />,
    )

    expect(screen.getByRole('list', { name: /debt obligations/i })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /2026-01-01/i })).toHaveTextContent(/original/i)
    expect(screen.getAllByText(/benefit-1/i)).not.toHaveLength(0)
    expect(screen.getByText(/settlement-1/i)).toBeInTheDocument()
    expect(screen.getByText(/eligible for reversal/i)).toBeInTheDocument()
    expect(screen.queryByText(/authorization|audit/i)).not.toBeInTheDocument()
  })
})
