import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DebtPanel, type DebtDetail } from './DebtPanel'

const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
// prettier-ignore
const debt = { status:'ready', socio_id:'socio-1', currency:'ARS', total_debt_cents:10_000, obligations:[{ id:'obligation-1', period_start:'2026-01-01', period_end:'2026-02-01', original_amount_cents:12_500, outstanding_cents:10_000, currency:'ARS', status:'OPEN', components:[{id:'component-1',kind:'BASE',component_key:'base',amount_cents:12_500},{id:'component-2',kind:'BENEFIT',component_key:'benefit-1',amount_cents:-2_500}], benefits:[{id:'component-2',component_key:'benefit-1',amount_cents:-2_500}], allocations:[{id:'allocation-1',settlement_id:'settlement-1',settlement_kind:'MONETARY',settlement_amount_cents:2_500,currency:'ARS',amount_cents:2_500,kind:'ALLOCATION',compensates_allocation_id:null,reversal_eligible:true}] }] } satisfies DebtDetail

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

    expect(screen.getByRole('status')).toHaveTextContent(/no hay deuda/i)
    expect(screen.getByRole('heading', { name: /detalle de deuda/i })).toBeInTheDocument()
  })

  it('announces an unavailable read as an alert', () => {
    render(
      <DebtPanel
        socio={socio}
        status="unavailable"
        debt={null}
        error="El detalle de deuda no está disponible."
        onSearch={vi.fn()}
        onSelectSocio={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/no está disponible/i)
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

    expect(screen.getByRole('list', { name: /obligaciones de deuda/i })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /2026-01-01/i })).toHaveTextContent(
      /importe original/i,
    )
    expect(screen.getAllByText(/benefit-1/i)).not.toHaveLength(0)
    expect(screen.getByText(/settlement-1/i)).toBeInTheDocument()
    expect(screen.getByText(/se puede revertir/i)).toBeInTheDocument()
    expect(screen.queryByText(/authorization|audit/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Buscar socio')).toHaveClass('min-h-11')
    expect(screen.getByRole('list', { name: /obligaciones de deuda/i })).toHaveClass(
      'md:grid-cols-2',
    )
  })

  it('itemizes settlements and compensations without treatment controls', () => {
    const itemizedDebt = {
      ...debt,
      obligations: [
        {
          ...debt.obligations[0]!,
          allocations: [
            ...debt.obligations[0]!.allocations,
            {
              id: 'compensation-1',
              settlement_id: 'settlement-reversal-1',
              settlement_kind: 'MONETARY',
              settlement_amount_cents: 2_500,
              currency: 'ARS',
              amount_cents: -2_500,
              kind: 'COMPENSATION',
              compensates_allocation_id: 'allocation-1',
              reversal_eligible: false,
            },
          ],
        },
      ],
    } satisfies DebtDetail
    render(
      <DebtPanel
        socio={socio}
        status="ready"
        debt={itemizedDebt}
        error=""
        onSearch={vi.fn()}
        onSelectSocio={vi.fn()}
        {...({
          onPayment: vi.fn(),
          onReverse: vi.fn(),
          agreementsEnabled: true,
          onCreateAgreement: vi.fn(),
          onRefreshAgreement: vi.fn(),
        } as object)}
      />,
    )

    expect(screen.getByText(/settlement-1 · MONETARY: 25.00 ARS/i)).toBeInTheDocument()
    expect(screen.getByText('Asignación')).toBeInTheDocument()
    const history = screen.getByRole('list', {
      name: 'Historial de liquidaciones del período 2026-01-01',
    })
    const reversalSettlement = within(history).getByText(
      (_, element) =>
        element?.tagName === 'DD' &&
        element.textContent?.split(' · ')[0] === 'settlement-reversal-1',
    )
    const reversalRow = reversalSettlement.closest('li')
    if (!reversalRow)
      throw new Error('Expected settlement-reversal-1 to be inside a settlement history list item')
    expect(within(reversalRow).getByText('-25.00 ARS', { exact: true })).toBeInTheDocument()
    expect(screen.getByText(/compensa la asignación allocation-1/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /acciones de pago/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar acuerdo' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /registrar trabajo comunitario/i }),
    ).not.toBeInTheDocument()
  })

  it('distinguishes a ready response with no itemized obligations from debt history', () => {
    render(
      <DebtPanel
        socio={socio}
        status="ready"
        debt={{ ...debt, total_debt_cents: 0, obligations: [] }}
        error=""
        onSearch={vi.fn()}
        onSelectSocio={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/no hay obligaciones/i)
  })
})
