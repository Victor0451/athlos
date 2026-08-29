import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CollectionStatus } from './CollectionStatus'

describe('CollectionStatus', () => {
  it.each([
    ['neutral', 'status', 'polite', 'bg-info-soft'],
    ['error', 'alert', 'assertive', 'bg-danger-soft'],
  ] as const)(
    'renders the %s status with its live-region contract',
    (tone, role, live, toneClass) => {
      render(<CollectionStatus tone={tone}>Estado de cobranza</CollectionStatus>)

      const status = screen.getByRole(role)
      expect(status).toHaveAttribute('aria-live', live)
      expect(status).toHaveClass('min-w-0', 'border', toneClass)
    },
  )
})
