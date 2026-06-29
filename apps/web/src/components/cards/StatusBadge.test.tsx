import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

/**
 * StatusBadge tests (TASK-015, PR 8a.3).
 *
 * The dashboard uses StatusBadge for the API Health card's `status`
 * field and for each scheduler job's health flag. The contract:
 *   - `healthy` → "Operativo" (success color)
 *   - `degraded` → "Degradado" (warning color)
 *   - `down` → "Caído" (danger color)
 *   - `disabled` → "Deshabilitado" (neutral / ink-500)
 *   - `unknown` → "Desconocido" (info color)
 *
 * Visual assertion strategy: query by role="status" with the label
 * text — proves the badge is announced to assistive tech AND renders
 * the right copy. CSS class introspection is intentionally avoided
 * (per the Strict TDD rules on implementation-detail coupling).
 */

describe('StatusBadge', () => {
  it('renders "Operativo" for a healthy status', () => {
    render(<StatusBadge status="healthy" />)
    expect(screen.getByRole('status', { name: /operativo/i })).toBeInTheDocument()
  })

  it('renders "Degradado" for a degraded status', () => {
    render(<StatusBadge status="degraded" />)
    expect(screen.getByRole('status', { name: /degradado/i })).toBeInTheDocument()
  })

  it('renders "Caído" for a down status', () => {
    render(<StatusBadge status="down" />)
    expect(screen.getByRole('status', { name: /caído/i })).toBeInTheDocument()
  })

  it('renders "Deshabilitado" for a disabled status', () => {
    render(<StatusBadge status="disabled" />)
    expect(screen.getByRole('status', { name: /deshabilitado/i })).toBeInTheDocument()
  })

  it('renders "Desconocido" for an unknown status', () => {
    render(<StatusBadge status="unknown" />)
    expect(screen.getByRole('status', { name: /desconocido/i })).toBeInTheDocument()
  })
})
