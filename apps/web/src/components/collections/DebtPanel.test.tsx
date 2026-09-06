import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DebtPanel, type DebtDetail } from './DebtPanel'

const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
const debt = {
  status: 'ready',
  socio_id: 'socio-1',
  currency: 'ARS',
  total_debt_cents: 10_000,
  obligations: [],
} satisfies DebtDetail

function panel(overrides: Partial<React.ComponentProps<typeof DebtPanel>> = {}) {
  return (
    <DebtPanel
      socio={socio}
      status="ready"
      debt={debt}
      error=""
      onSearch={vi.fn()}
      onSelectSocio={vi.fn()}
      {...overrides}
    />
  )
}

describe('DebtPanel', () => {
  it('composes search and selected-member pending total', () => {
    render(panel())

    const summary = screen.getByLabelText(/resumen de deuda/i)
    expect(screen.getByRole('search', { name: /buscar un socio/i })).toBeInTheDocument()
    expect(summary).toHaveTextContent(/gorriti, ana/i)
    expect(summary).toHaveTextContent(/\$\s?100,00/i)
  })

  it('reports empty and not-found debt states', () => {
    const { rerender } = render(panel({ status: 'empty', debt: { ...debt, status: 'empty' } }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'No hay deuda registrada todavía para este socio.',
    )

    rerender(panel({ status: 'not_found', debt: null }))
    expect(screen.getByRole('status')).toHaveTextContent(/no se encontró el detalle/i)
  })

  it('focuses an unavailable debt alert', () => {
    render(
      panel({
        status: 'unavailable',
        debt: null,
        error: 'El detalle de deuda no está disponible.',
      }),
    )

    expect(screen.getByRole('alert')).toHaveFocus()
  })
})
