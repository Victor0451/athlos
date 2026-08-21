import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import type { DebtDetail } from '@/lib/api/dues'
import { SettlementActions } from './SettlementActions'

// prettier-ignore
const debt={status:'ready',socio_id:'socio-1',currency:'ARS',total_debt_cents:10_000,obligations:[{id:'obligation-1',period_start:'2026-01-01',period_end:'2026-02-01',original_amount_cents:6_000,outstanding_cents:6_000,currency:'ARS',status:'OPEN',components:[],benefits:[],allocations:[]},{id:'obligation-2',period_start:'2026-02-01',period_end:'2026-03-01',original_amount_cents:4_000,outstanding_cents:4_000,currency:'ARS',status:'OPEN',components:[],benefits:[],allocations:[{id:'allocation-1',settlement_id:'settlement-1',settlement_kind:'MONETARY',settlement_amount_cents:2_000,currency:'ARS',amount_cents:2_000,kind:'ALLOCATION',compensates_allocation_id:null,reversal_eligible:true}]}]} as DebtDetail
const renderActions = (onAllocate = vi.fn(), onReverse = vi.fn()) =>
  render(<SettlementActions debt={debt} onAllocate={onAllocate} onReverse={onReverse} />)

describe('SettlementActions', () => {
  it('submits explicit unique allocations across obligations', async () => {
    const user = userEvent.setup(),
      onAllocate = vi.fn().mockResolvedValue({ replayed: false })
    renderActions(onAllocate)
    await user.click(screen.getByRole('button', { name: /record native settlement/i }))
    const first = screen.getByLabelText(/amount for 2026-01-01/i),
      second = screen.getByLabelText(/amount for 2026-02-01/i)
    await user.type(first, '2000')
    await user.type(second, '3000')
    await user.click(screen.getByRole('button', { name: /confirm native settlement/i }))
    expect(onAllocate).toHaveBeenCalledWith({
      amount_cents: 5_000,
      allocations: [
        { obligation_id: 'obligation-1', amount_cents: 2_000 },
        { obligation_id: 'obligation-2', amount_cents: 3_000 },
      ],
    })
  })
  it('retains a 409 draft, focuses review, and retries after review', async () => {
    const user = userEvent.setup(),
      onAllocate = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Balance changed'))
        .mockResolvedValueOnce({ replayed: true })
    renderActions(onAllocate)
    await user.click(screen.getByRole('button', { name: /record native settlement/i }))
    const amount = screen.getByLabelText(/amount for 2026-01-01/i)
    await user.type(amount, '2000')
    await user.click(screen.getByRole('button', { name: /confirm native settlement/i }))
    expect(amount).toHaveValue(2000)
    expect(screen.getByRole('alert')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /review refreshed balances/i }))
    await user.click(screen.getByRole('button', { name: /confirm native settlement/i }))
    expect(onAllocate).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent(/replayed/i)
  })
  it('requires a reason and appends a compensation reversal without cash controls', async () => {
    const user = userEvent.setup(),
      onReverse = vi.fn().mockResolvedValue({ replayed: false })
    renderActions(undefined, onReverse)
    await user.click(screen.getByRole('button', { name: /reverse allocation-1/i }))
    const confirm = screen.getByRole('button', { name: /confirm reversal/i })
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText(/reversal reason/i), 'Incorrect allocation')
    await user.click(confirm)
    expect(onReverse).toHaveBeenCalledWith({
      settlement_id: 'settlement-1',
      allocation_id: 'allocation-1',
      reason: 'Incorrect allocation',
    })
    expect(screen.getByRole('status')).toHaveTextContent(/compensation/i)
    expect(screen.queryByText(/cash|reconciliation/i)).not.toBeInTheDocument()
  })
})
