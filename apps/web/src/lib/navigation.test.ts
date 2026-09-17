import { describe, expect, it } from 'vitest'
import { visibleNavigation } from './navigation'

const user = { role: 'TESORERO', permissions: { data_steward: false } } as never

describe('approvals navigation', () => {
  it.each(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA'] as const)(
    'gates the queue for %s',
    (role) => {
      const actor = { role, permissions: { data_steward: false } } as never
      expect(visibleNavigation(actor).some((item) => item.href === '/admin/approvals')).toBe(
        role === 'ADMIN' || role === 'TESORERO',
      )
    },
  )
})

describe('cash navigation feature gate', () => {
  it('hides treasury when the server-provided cash feature is disabled', () => {
    expect(
      visibleNavigation(user, { cashEnabled: false }).some((item) => item.href === '/tesoreria'),
    ).toBe(false)
    expect(
      visibleNavigation(user, { cashEnabled: true }).some((item) => item.href === '/tesoreria'),
    ).toBe(true)
  })

  it('shows the enabled Caja entry to an operator without requiring an active shift', () => {
    const operator = { role: 'OPERADOR', permissions: { data_steward: false } } as never

    expect(visibleNavigation(operator, { cashEnabled: true })).toContainEqual(
      expect.objectContaining({ href: '/tesoreria', label: 'Cash desk' }),
    )
    expect(visibleNavigation(operator, { cashEnabled: false })).not.toContainEqual(
      expect.objectContaining({ href: '/tesoreria' }),
    )
  })
})

describe('Collections navigation feature gate', () => {
  it('hides Collections by default', () => {
    expect(visibleNavigation(user).some((item) => item.href === '/collections')).toBe(false)
  })

  it('uses the existing operations section with a Spanish label when enabled', () => {
    expect(visibleNavigation(user, { collectionsEnabled: true })).toContainEqual(
      expect.objectContaining({
        href: '/collections',
        label: 'Cobranza',
        section: 'Operations',
      }),
    )
  })
})
