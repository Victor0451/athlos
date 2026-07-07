import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * `<OperatorChip>` tests (PR 8b.5 of `athlos-audit-operator-display`).
 *
 * Pins the render contract per design D7 + §UI Rendering Details:
 *   - operatorId === null → "Operador desconocido"
 *   - operatorId !== null && !operators.has(operatorId) → "Operador desconocido"
 *   - operatorId !== null && operators.has(operatorId) → `${username} · ${role}`
 *
 * The casing pin (case "UsEr" → renders "UsEr · ADMIN", no
 * `toTitleCase`) is the most important behavioural pin: future
 * contributors must NOT add a title-case step (locked spec rule).
 *
 * Loading state (D10): while the consumer's `useQuery` is pending,
 * the chip receives an empty `Map`. The contract is that an empty
 * map renders "Operador desconocido" — same as the missing-id branch.
 */

const { OperatorChip } = await import('./OperatorChip')

const KNOWN_ID = '00000000-0000-4000-8000-000000000001'

function makeOperator(
  id: string,
  username: string,
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA',
) {
  return { id, username, role }
}

describe('OperatorChip', () => {
  it('renders "Operador desconocido" when operatorId is null', () => {
    render(<OperatorChip operatorId={null} operators={new Map()} />)

    expect(screen.getByText('Operador desconocido')).toBeInTheDocument()
  })

  it('renders "Operador desconocido" when operatorId is not in the operators map', () => {
    const map = new Map([[KNOWN_ID, makeOperator(KNOWN_ID, 'vlongo', 'ADMIN')]])
    render(<OperatorChip operatorId={'some-other-id'} operators={map} />)

    expect(screen.getByText('Operador desconocido')).toBeInTheDocument()
  })

  it('renders "Operador desconocido" when the operators map is empty (loading state)', () => {
    render(<OperatorChip operatorId={KNOWN_ID} operators={new Map()} />)

    expect(screen.getByText('Operador desconocido')).toBeInTheDocument()
  })

  it('renders "username · ROLE" when the operator is in the map', () => {
    const map = new Map([[KNOWN_ID, makeOperator(KNOWN_ID, 'vlongo', 'ADMIN')]])
    render(<OperatorChip operatorId={KNOWN_ID} operators={map} />)

    expect(screen.getByText('vlongo · ADMIN')).toBeInTheDocument()
  })

  it('preserves username casing verbatim — "UsEr" stays "UsEr · ADMIN" (no toTitleCase)', () => {
    const map = new Map([[KNOWN_ID, makeOperator(KNOWN_ID, 'UsEr', 'ADMIN')]])
    render(<OperatorChip operatorId={KNOWN_ID} operators={map} />)

    // Pin the exact rendered text — a future contributor adding
    // `toTitleCase` would produce "User · ADMIN" which this assertion
    // catches.
    expect(screen.getByText('UsEr · ADMIN')).toBeInTheDocument()
    expect(screen.queryByText('User · ADMIN')).not.toBeInTheDocument()
  })

  it('renders each of the four role labels verbatim', () => {
    const cases: Array<'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'> = [
      'ADMIN',
      'TESORERO',
      'OPERADOR',
      'CONSULTA',
    ]
    for (const role of cases) {
      const map = new Map([[KNOWN_ID, makeOperator(KNOWN_ID, 'someone', role)]])
      const { unmount } = render(<OperatorChip operatorId={KNOWN_ID} operators={map} />)
      expect(screen.getByText(`someone · ${role}`)).toBeInTheDocument()
      unmount()
    }
  })
})
