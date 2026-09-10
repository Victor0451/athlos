import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PesoAmountInput } from './PesoAmountInput'

it.each([true, false])(
  'preserves select-all around focus (select first: %s)',
  async (selectFirst) => {
    render(
      <PesoAmountInput
        aria-label="Amount"
        value="15600"
        parseCents={() => 1560000}
        onChange={vi.fn()}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement
    await act(async () => {
      if (selectFirst) input.setSelectionRange(0, input.value.length)
      input.focus()
      if (!selectFirst) input.setSelectionRange(0, input.value.length)
    })

    expect(input).toHaveValue('15600')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(5)
  },
)

it('keeps the DOM formatted when focus and blur are batched without a state change', async () => {
  render(
    <PesoAmountInput
      aria-label="Amount"
      value="15600"
      parseCents={() => 1560000}
      onChange={vi.fn()}
    />,
  )
  const input = screen.getByRole('textbox', { name: 'Amount' })
  expect(input).toHaveValue('15.600,00')

  await act(async () => {
    input.focus()
    input.blur()
  })

  expect(input).toHaveValue('15.600,00')
})
