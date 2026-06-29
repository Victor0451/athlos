import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * OperatorProfile component tests (TASK-039, PR 8c.2).
 *
 * `<OperatorProfile>` renders the current operator's profile in
 * a clean read-only card: username, role (translated), last login
 * (es-AR locale), account created, and the two boolean permission
 * flags (can_reprint, can_anulate). Used by the settings page at
 * `/admin/settings` (TASK-038).
 *
 * Contract:
 *   - Renders username as the primary heading
 *   - Renders the translated role label (ADMIN → Administrador, etc.)
 *   - Renders the last_login_at timestamp in es-AR locale when present
 *   - Renders "Nunca" when last_login_at is null
 *   - Renders the account created_at timestamp in es-AR short format
 *   - Renders the can_reprint permission (Sí / No)
 *   - Renders the can_anulate permission (Sí / No)
 *   - Pure presentation — no data fetching
 */

const { OperatorProfile } = await import('./OperatorProfile')

const SAMPLE_PROFILE = {
  id: 'op-1',
  username: 'admin',
  role: 'ADMIN' as const,
  can_reprint: true,
  can_anulate: true,
  is_active: true,
  last_login_at: '2026-06-28T10:00:00.000Z',
  created_at: '2024-01-15T08:00:00.000Z',
}

describe('OperatorProfile', () => {
  beforeEach(() => {
    // No-op — render is pure, but kept for consistency with sibling suites.
  })

  it('renders the username as the primary heading', () => {
    render(<OperatorProfile profile={SAMPLE_PROFILE} />)
    expect(screen.getByRole('heading', { name: 'admin', level: 2 })).toBeInTheDocument()
  })

  it('translates the role to a Spanish display label (ADMIN → Administrador)', () => {
    render(<OperatorProfile profile={SAMPLE_PROFILE} />)
    expect(screen.getByTestId('operator-role')).toHaveTextContent('Administrador')
  })

  it('translates TESORERO → Tesorero', () => {
    render(<OperatorProfile profile={{ ...SAMPLE_PROFILE, role: 'TESORERO' }} />)
    expect(screen.getByTestId('operator-role')).toHaveTextContent('Tesorero')
  })

  it('translates OPERADOR → Operador', () => {
    render(<OperatorProfile profile={{ ...SAMPLE_PROFILE, role: 'OPERADOR' }} />)
    expect(screen.getByTestId('operator-role')).toHaveTextContent('Operador')
  })

  it('translates CONSULTA → Consulta', () => {
    render(<OperatorProfile profile={{ ...SAMPLE_PROFILE, role: 'CONSULTA' }} />)
    expect(screen.getByTestId('operator-role')).toHaveTextContent('Consulta')
  })

  it('renders the last_login_at timestamp in es-AR locale', () => {
    render(<OperatorProfile profile={SAMPLE_PROFILE} />)
    const lastLoginEl = screen.getByTestId('operator-last-login')
    // es-AR short renders "28/6/26" — match day/month prefix only
    expect(lastLoginEl.textContent).toMatch(/28\/6/)
  })

  it('renders "Nunca" when last_login_at is null', () => {
    render(<OperatorProfile profile={{ ...SAMPLE_PROFILE, last_login_at: null }} />)
    expect(screen.getByText(/nunca/i)).toBeInTheDocument()
  })

  it('renders the created_at timestamp in es-AR short format', () => {
    render(<OperatorProfile profile={SAMPLE_PROFILE} />)
    const createdEl = screen.getByTestId('operator-created-at')
    expect(createdEl.textContent).toMatch(/15\/1/)
  })

  it('renders the can_reprint permission as Sí when true', () => {
    render(<OperatorProfile profile={SAMPLE_PROFILE} />)
    const reprintEl = screen.getByTestId('operator-can-reprint')
    expect(reprintEl).toHaveTextContent('Sí')
  })

  it('renders the can_reprint permission as No when false', () => {
    render(<OperatorProfile profile={{ ...SAMPLE_PROFILE, can_reprint: false }} />)
    const reprintEl = screen.getByTestId('operator-can-reprint')
    expect(reprintEl).toHaveTextContent('No')
  })

  it('renders the can_anulate permission as Sí when true', () => {
    render(<OperatorProfile profile={SAMPLE_PROFILE} />)
    const anulateEl = screen.getByTestId('operator-can-anulate')
    expect(anulateEl).toHaveTextContent('Sí')
  })

  it('renders the can_anulate permission as No when false', () => {
    render(<OperatorProfile profile={{ ...SAMPLE_PROFILE, can_anulate: false }} />)
    const anulateEl = screen.getByTestId('operator-can-anulate')
    expect(anulateEl).toHaveTextContent('No')
  })

  it('exposes a stable region test-id for the settings page', () => {
    render(<OperatorProfile profile={SAMPLE_PROFILE} />)
    expect(screen.getByRole('region', { name: /perfil del operador/i })).toBeInTheDocument()
  })
})
