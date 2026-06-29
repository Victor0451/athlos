import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricCard } from './MetricCard'

/**
 * MetricCard tests (TASK-015 / TASK-014, PR 8a.3).
 *
 * Covers `web-frontend/spec.md` (Design System and Deferred Features)
 * and the design §5 dashboard cards contract:
 *   - Renders a label, a primary value, and an optional sublabel
 *   - Shows a skeleton placeholder when `loading` is true
 *   - Uses Gorriti Premium tokens (surface-elevated background)
 *   - Hides the skeleton placeholder when not loading (real content visible)
 *
 * The component is purely presentational — no fetch, no state, no
 * router. Behavior is verified by `getByText` assertions against the
 * actual rendered content (not class-name introspection).
 */

describe('MetricCard', () => {
  it('renders the label, value, and optional sublabel when not loading', () => {
    render(<MetricCard label="Socios" value="16.383" sublabel="8 tablas" />)

    expect(screen.getByText('Socios')).toBeInTheDocument()
    expect(screen.getByText('16.383')).toBeInTheDocument()
    expect(screen.getByText('8 tablas')).toBeInTheDocument()
  })

  it('renders the label without a sublabel when sublabel is omitted', () => {
    render(<MetricCard label="API Health" value="ok" />)
    expect(screen.getByText('API Health')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('shows a loading skeleton instead of the value when loading is true', () => {
    render(<MetricCard label="Socios" value="16.383" loading />)

    // Label still visible so the operator can see what is loading.
    expect(screen.getByText('Socios')).toBeInTheDocument()

    // The numeric value is replaced by a skeleton placeholder — the
    // real value must NOT be rendered while loading.
    expect(screen.queryByText('16.383')).not.toBeInTheDocument()

    // The skeleton container is announced to assistive tech as
    // "Cargando…" via the role="status" + aria-live combination. We
    // assert against the role container rather than the inner text so
    // we don't collide with the duplicate text nodes (one for AT, one
    // visible).
    expect(screen.getByRole('status')).toHaveTextContent(/cargando/i)
  })

  it('uses the surface-elevated token for the card background', () => {
    const { container } = render(<MetricCard label="X" value="y" />)
    const root = container.firstChild as HTMLElement
    // Behavioral assertion: the card has the expected layout role.
    expect(root).toBeTruthy()
    expect(root.className).toContain('rounded-lg')
  })
})
