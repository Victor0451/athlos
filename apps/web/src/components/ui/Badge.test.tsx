import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

/**
 * Unit tests for the Gorriti Premium Badge primitive.
 */

import { Badge } from './Badge'

describe('Badge', () => {
  it('renders the default variant with surface-sunken bg', () => {
    render(<Badge>Activo</Badge>)
    const badge = screen.getByText('Activo')
    expect(badge.tagName).toBe('SPAN')
    expect(badge.className).toMatch(/bg-surface-sunken/)
    expect(badge.className).toMatch(/text-ink-700/)
  })

  it('renders the success variant with accent-soft bg and accent text', () => {
    render(<Badge variant="success">Activo</Badge>)
    const badge = screen.getByText('Activo')
    expect(badge.className).toMatch(/bg-accent-soft/)
    expect(badge.className).toMatch(/text-accent/)
  })

  it('renders the warning variant with #fef7e6 bg and #92670f text', () => {
    render(<Badge variant="warning">Suspendido</Badge>)
    const badge = screen.getByText('Suspendido')
    expect(badge.className).toMatch(/bg-warning-soft/)
    expect(badge.className).toMatch(/text-warning/)
  })

  it('renders the danger variant (for soft-deleted / error states)', () => {
    render(<Badge variant="danger">Baja</Badge>)
    const badge = screen.getByText('Baja')
    expect(badge.className).toMatch(/bg-danger-soft/)
    expect(badge.className).toMatch(/text-accent/)
  })

  it('renders the info variant', () => {
    render(<Badge variant="info">42 notificaciones</Badge>)
    const badge = screen.getByText('42 notificaciones')
    expect(badge.className).toMatch(/bg-info-soft/)
    expect(badge.className).toMatch(/text-info/)
  })

  it('exposes a data-testid when provided', () => {
    render(
      <Badge variant="success" dataTestid="estado-activo">
        Activo
      </Badge>,
    )
    expect(screen.getByTestId('estado-activo')).toHaveTextContent('Activo')
  })

  it('exposes an explicit aria-label when provided (for SR disambiguation)', () => {
    render(
      <Badge variant="success" ariaLabel="Socio activo" dataTestid="estado">
        Activo
      </Badge>,
    )
    expect(screen.getByTestId('estado')).toHaveAttribute('aria-label', 'Socio activo')
  })

  it('uses a small radius + tight padding per the design system', () => {
    render(<Badge>tag</Badge>)
    const badge = screen.getByText('tag')
    expect(badge.className).toMatch(/rounded px-2 py-0\.5/)
    expect(badge.className).toMatch(/text-xs font-medium/)
  })
})

/**
 * Unit tests for the Gorriti Premium Tabs primitive.
 */

import { Tabs } from './Tabs'

describe('Tabs', () => {
  const items: { key: 'datos' | 'contacto' | 'cuenta'; label: string; panelId: string }[] = [
    { key: 'datos', label: 'Datos personales', panelId: 'panel-datos' },
    { key: 'contacto', label: 'Contacto', panelId: 'panel-contacto' },
    { key: 'cuenta', label: 'Cuenta corriente', panelId: 'panel-cuenta' },
  ]

  it('renders one tab per item, all as role="tab"', () => {
    render(<Tabs items={items} activeKey="datos" onChange={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveTextContent('Datos personales')
    expect(tabs[1]).toHaveTextContent('Contacto')
    expect(tabs[2]).toHaveTextContent('Cuenta corriente')
  })

  it('marks the active tab with aria-selected and 2px accent border', () => {
    render(<Tabs items={items} activeKey="contacto" onChange={() => {}} />)
    const activeTab = screen.getByRole('tab', { name: 'Contacto' })
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(activeTab.className).toMatch(/border-accent/)
    expect(activeTab).toHaveAttribute('tabindex', '0')

    const inactiveTab = screen.getByRole('tab', { name: 'Datos personales' })
    expect(inactiveTab).toHaveAttribute('aria-selected', 'false')
    expect(inactiveTab).toHaveAttribute('tabindex', '-1')
    expect(inactiveTab.className).not.toMatch(/border-accent/)
  })

  it('emits the right aria-controls pointing to each panelId', () => {
    render(<Tabs items={items} activeKey="datos" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Datos personales' })).toHaveAttribute(
      'aria-controls',
      'panel-datos',
    )
    expect(screen.getByRole('tab', { name: 'Contacto' })).toHaveAttribute(
      'aria-controls',
      'panel-contacto',
    )
  })

  it('calls onChange with the right key when a tab is clicked', () => {
    let captured: string | null = null
    render(
      <Tabs
        items={items}
        activeKey="datos"
        onChange={(key) => {
          captured = key
        }}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Contacto' }))
    expect(captured).toBe('contacto')
    fireEvent.click(screen.getByRole('tab', { name: 'Cuenta corriente' }))
    expect(captured).toBe('cuenta')
  })

  it('exposes the tablist as a nav with role="tablist" + aria-label', () => {
    render(<Tabs items={items} activeKey="datos" onChange={() => {}} />)
    const tablist = screen.getByRole('tablist', { name: 'Secciones' })
    expect(tablist.tagName).toBe('NAV')
  })
})
