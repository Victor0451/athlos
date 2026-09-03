import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const duesMocks = vi.hoisted(() => ({
  planDuesGeneration: vi.fn(),
  generateDuesAssessments: vi.fn(),
  DuesOperationError: class MockDuesOperationError extends Error {
    constructor(readonly kind: string) {
      super(kind)
    }
  },
}))

vi.mock('@/lib/api/dues', () => duesMocks)

import { CollectionsGenerationWorkspace } from './CollectionsGenerationWorkspace'

const plan = (fingerprint: string) => ({
  period: '2026-01',
  currency: 'ARS',
  plan_fingerprint: fingerprint,
  can_generate: true,
  configurations: [],
  summary: {
    ready_count: 1,
    new_count: 1,
    conflict_count: 0,
    review_count: 0,
    estimated_new_total_cents: 1200,
  },
  members: [],
})

const renderWorkspace = (onGoToCollections = vi.fn()) =>
  render(
    <CollectionsGenerationWorkspace
      period="2026-01"
      user={{ operator_id: 'operator-1', role: 'ADMIN' }}
      onGoToCollections={onGoToCollections}
    />,
  )

describe('CollectionsGenerationWorkspace', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('plans read-only, confirms with a key, completes, and returns to collections', async () => {
    const user = userEvent.setup()
    const onGoToCollections = vi.fn()
    duesMocks.planDuesGeneration.mockResolvedValue(plan('a'.repeat(64)))
    duesMocks.generateDuesAssessments.mockResolvedValue({
      period: '2026-01',
      generated_obligation_count: 1,
      retained_existing_count: 0,
      review_count: 0,
      generated_total_cents: 1200,
    })
    renderWorkspace(onGoToCollections)

    await user.selectOptions(screen.getByLabelText('Mes'), '01')
    await user.clear(screen.getByLabelText('Año'))
    await user.type(screen.getByLabelText('Año'), '2026')
    await user.click(screen.getByRole('button', { name: 'Revisar generación' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar generación' }))

    await waitFor(() =>
      expect(duesMocks.generateDuesAssessments).toHaveBeenCalledWith(
        '2026-01',
        'a'.repeat(64),
        expect.any(String),
      ),
    )
    expect(await screen.findByText(/se generaron 1 deudas/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('athlos:collections:idempotency')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ir a cobranza' }))
    expect(onGoToCollections).toHaveBeenCalledOnce()
  })

  it('abandons a conflict key, replans once, and does not retry generation', async () => {
    const user = userEvent.setup()
    duesMocks.planDuesGeneration
      .mockResolvedValueOnce(plan('a'.repeat(64)))
      .mockResolvedValueOnce(plan('b'.repeat(64)))
    duesMocks.generateDuesAssessments.mockRejectedValueOnce(
      new duesMocks.DuesOperationError('conflict'),
    )
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: 'Revisar generación' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar generación' }))

    await waitFor(() => expect(duesMocks.planDuesGeneration).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toHaveTextContent(/datos cambiaron/i)
    expect(duesMocks.generateDuesAssessments).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('athlos:collections:idempotency')).toBeNull()
  })

  it('shows a safe error when planning fails', async () => {
    const user = userEvent.setup()
    duesMocks.planDuesGeneration.mockRejectedValueOnce(new Error('unsafe'))
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: 'Revisar generación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo revisar la generación del período.',
    )
  })

  it('shows a safe error when generation fails', async () => {
    const user = userEvent.setup()
    duesMocks.planDuesGeneration.mockResolvedValue(plan('a'.repeat(64)))
    duesMocks.generateDuesAssessments.mockRejectedValueOnce(new Error('unsafe'))
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: 'Revisar generación' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar generación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo generar las deudas. Intentá nuevamente.',
    )
  })
})
