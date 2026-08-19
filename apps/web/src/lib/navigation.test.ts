import { describe, expect, it } from 'vitest'
import { visibleNavigation } from './navigation'

const user = { role: 'TESORERO', permissions: { data_steward: false } } as never

describe('cash navigation feature gate', () => {
  it('hides treasury when the server-provided cash feature is disabled', () => {
    expect(
      visibleNavigation(user, { cashEnabled: false }).some((item) => item.href === '/tesoreria'),
    ).toBe(false)
    expect(
      visibleNavigation(user, { cashEnabled: true }).some((item) => item.href === '/tesoreria'),
    ).toBe(true)
  })
})
