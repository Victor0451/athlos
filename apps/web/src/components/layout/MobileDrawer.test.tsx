import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'

const authState = vi.hoisted(() => ({
  user: {
    operator_id: 'op-1',
    role: 'CONSULTA' as 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA',
    username: 'consulta',
    permissions: { can_reprint: false, can_anulate: false, data_steward: false },
  },
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => authState.user,
  getAccessToken: () => 'token',
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))

import MobileDrawer from './MobileDrawer.tsx'

function DrawerHarness() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Abrir navegación
      </button>
      <main data-mobile-drawer-background="true" data-testid="background">
        Contenido protegido
      </main>
      <MobileDrawer open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} />
    </>
  )
}

describe('MobileDrawer', () => {
  beforeEach(() => {
    document.body.style.overflow = ''
    authState.user.role = 'CONSULTA'
  })

  afterEach(() => vi.restoreAllMocks())

  it('labels the drawer, filters inaccessible navigation, and blocks the background', async () => {
    const user = userEvent.setup()
    render(<DrawerHarness />)

    await user.click(screen.getByRole('button', { name: /abrir navegación/i }))

    expect(screen.getByRole('dialog', { name: /navegación principal/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /scheduler/i })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByTestId('background')).toHaveAttribute('inert')
  })

  it('cycles focus and restores the trigger after Escape, overlay, and navigation dismissal', async () => {
    const user = userEvent.setup()
    render(<DrawerHarness />)
    const trigger = screen.getByRole('button', { name: /abrir navegación/i })

    await user.click(trigger)
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('link', { name: /padrones/i })).toHaveFocus()
    await user.keyboard('{Tab}')
    expect(screen.getByRole('button', { name: /cerrar navegación/i })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByTestId('mobile-drawer-overlay'))
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByRole('link', { name: /socios/i }))
    expect(trigger).toHaveFocus()
  })
})
