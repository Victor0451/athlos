import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/AppShell', () => ({
  default: ({
    children,
    cashEnabled,
    collectionsEnabled,
    agreementsEnabled,
  }: {
    children: ReactNode
    cashEnabled: boolean
    collectionsEnabled: boolean
    agreementsEnabled: boolean
  }) => (
    <div
      data-testid="feature-config"
      data-cash-enabled={String(cashEnabled)}
      data-collections-enabled={String(collectionsEnabled)}
      data-agreements-enabled={String(agreementsEnabled)}
    >
      {children}
    </div>
  ),
}))

const { default: AuthedLayout, dynamic } = await import('./layout')

const originalAssessment = process.env.DUES_ASSESSMENT_ENABLED
const originalCash = process.env.DUES_CASH_ENABLED
const originalCollections = process.env.NATIVE_COLLECTIONS_WEB_ENABLED
const originalAgreements = process.env.DUES_AGREEMENTS_ENABLED

afterEach(() => {
  if (originalAssessment === undefined) delete process.env.DUES_ASSESSMENT_ENABLED
  else process.env.DUES_ASSESSMENT_ENABLED = originalAssessment
  if (originalCash === undefined) delete process.env.DUES_CASH_ENABLED
  else process.env.DUES_CASH_ENABLED = originalCash
  if (originalCollections === undefined) delete process.env.NATIVE_COLLECTIONS_WEB_ENABLED
  else process.env.NATIVE_COLLECTIONS_WEB_ENABLED = originalCollections
  if (originalAgreements === undefined) delete process.env.DUES_AGREEMENTS_ENABLED
  else process.env.DUES_AGREEMENTS_ENABLED = originalAgreements
})

describe('authed Web feature configuration', () => {
  it('opts out of static generation so runtime flags reach the client shell', () => {
    expect(dynamic).toBe('force-dynamic')
  })

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

    expect(screen.getByTestId('feature-config')).toHaveAttribute(
      'data-collections-enabled',
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

    expect(screen.getByTestId('feature-config')).toHaveAttribute(
      'data-collections-enabled',
      'false',
    )
  })

  it('keeps Web Collections enabled when assessment APIs are disabled', () => {
    process.env.DUES_ASSESSMENT_ENABLED = 'false'
    process.env.NATIVE_COLLECTIONS_WEB_ENABLED = 'true'

    render(
      <AuthedLayout>
        <span>content</span>
      </AuthedLayout>,
    )

    expect(screen.getByTestId('feature-config')).toHaveAttribute('data-collections-enabled', 'true')
  })

  it('passes both independent workflow flags to the shell', () => {
    process.env.NATIVE_COLLECTIONS_WEB_ENABLED = 'false'
    process.env.DUES_AGREEMENTS_ENABLED = 'true'

    render(
      <AuthedLayout>
        <span>content</span>
      </AuthedLayout>,
    )

    expect(screen.getByTestId('feature-config')).toHaveAttribute(
      'data-collections-enabled',
      'false',
    )
    expect(screen.getByTestId('feature-config')).toHaveAttribute('data-agreements-enabled', 'true')
  })

  it.each([
    ['absent', undefined, false],
    ['explicit false', 'false', false],
    ['explicit true', 'true', true],
  ] as const)('maps the agreement workflow flag: %s', (_label, value, expected) => {
    if (value === undefined) delete process.env.DUES_AGREEMENTS_ENABLED
    else process.env.DUES_AGREEMENTS_ENABLED = value

    render(
      <AuthedLayout>
        <span>content</span>
      </AuthedLayout>,
    )

    expect(screen.getByTestId('feature-config')).toHaveAttribute(
      'data-agreements-enabled',
      String(expected),
    )
  })

  it.each([
    ['absent', undefined, false],
    ['explicit false', 'false', false],
    ['explicit true', 'true', true],
  ] as const)('maps the cash flag at runtime: %s', (_label, value, expected) => {
    if (value === undefined) delete process.env.DUES_CASH_ENABLED
    else process.env.DUES_CASH_ENABLED = value

    render(
      <AuthedLayout>
        <span>content</span>
      </AuthedLayout>,
    )

    expect(screen.getByTestId('feature-config')).toHaveAttribute(
      'data-cash-enabled',
      String(expected),
    )
  })
})
