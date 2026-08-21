import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/AppShell', () => ({
  default: ({
    children,
    collectionsEnabled,
  }: {
    children: ReactNode
    collectionsEnabled: boolean
  }) => (
    <div data-testid="collections-enabled" data-enabled={String(collectionsEnabled)}>
      {children}
    </div>
  ),
}))

const { default: AuthedLayout } = await import('./layout')

const originalAssessment = process.env.DUES_ASSESSMENT_ENABLED
const originalCollections = process.env.NATIVE_COLLECTIONS_WEB_ENABLED

afterEach(() => {
  if (originalAssessment === undefined) delete process.env.DUES_ASSESSMENT_ENABLED
  else process.env.DUES_ASSESSMENT_ENABLED = originalAssessment
  if (originalCollections === undefined) delete process.env.NATIVE_COLLECTIONS_WEB_ENABLED
  else process.env.NATIVE_COLLECTIONS_WEB_ENABLED = originalCollections
})

describe('authed Web feature configuration', () => {
  it.each([
    ['absent', undefined, false],
    ['explicit false', 'false', false],
    ['explicit true', 'true', true],
  ] as const)('maps the dedicated Collections Web flag: %s', (_label, value, expected) => {
    delete process.env.DUES_ASSESSMENT_ENABLED
    if (value === undefined) delete process.env.NATIVE_COLLECTIONS_WEB_ENABLED
    else process.env.NATIVE_COLLECTIONS_WEB_ENABLED = value

    render(
      <AuthedLayout>
        <span>content</span>
      </AuthedLayout>,
    )

    expect(screen.getByTestId('collections-enabled')).toHaveAttribute(
      'data-enabled',
      String(expected),
    )
  })

  it('keeps Web Collections disabled when assessment APIs are enabled', () => {
    process.env.DUES_ASSESSMENT_ENABLED = 'true'
    delete process.env.NATIVE_COLLECTIONS_WEB_ENABLED

    render(
      <AuthedLayout>
        <span>content</span>
      </AuthedLayout>,
    )

    expect(screen.getByTestId('collections-enabled')).toHaveAttribute('data-enabled', 'false')
  })

  it('keeps Web Collections enabled when assessment APIs are disabled', () => {
    process.env.DUES_ASSESSMENT_ENABLED = 'false'
    process.env.NATIVE_COLLECTIONS_WEB_ENABLED = 'true'

    render(
      <AuthedLayout>
        <span>content</span>
      </AuthedLayout>,
    )

    expect(screen.getByTestId('collections-enabled')).toHaveAttribute('data-enabled', 'true')
  })
})
