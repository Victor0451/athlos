import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaymentMethodSelector } from './PaymentMethodSelector'

describe('PaymentMethodSelector', () => {
  it('uses human labels and emits wire-safe payment selections', async () => {
    const user = userEvent.setup()
    const onMethodChange = vi.fn()
    const onCardSubtypeChange = vi.fn()
    const { rerender } = render(
      <PaymentMethodSelector
        paymentMethod="TRANSFER"
        cardSubtype={null}
        onMethodChange={onMethodChange}
        onCardSubtypeChange={onCardSubtypeChange}
      />,
    )

    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Tarjeta' })).toBeInTheDocument()
    expect(screen.queryByText(/^DEBIT$|^CREDIT$|^CASH$|^TRANSFER$/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Efectivo' }))
    expect(onMethodChange).toHaveBeenCalledWith('CASH')
    rerender(
      <PaymentMethodSelector
        paymentMethod="CASH"
        cardSubtype={null}
        onMethodChange={onMethodChange}
        onCardSubtypeChange={onCardSubtypeChange}
      />,
    )
    await user.click(screen.getByRole('radio', { name: 'Transferencia' }))
    expect(onMethodChange).toHaveBeenLastCalledWith('TRANSFER')

    rerender(
      <PaymentMethodSelector
        paymentMethod="CARD"
        cardSubtype={null}
        onMethodChange={onMethodChange}
        onCardSubtypeChange={onCardSubtypeChange}
      />,
    )
    await user.click(screen.getByRole('radio', { name: 'Débito' }))
    expect(onCardSubtypeChange).toHaveBeenCalledWith('DEBIT')
    await user.click(screen.getByRole('radio', { name: 'Crédito' }))
    expect(onCardSubtypeChange).toHaveBeenLastCalledWith('CREDIT')
  })
})
