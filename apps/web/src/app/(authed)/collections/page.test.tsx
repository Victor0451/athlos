import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { GenerationPanel } from '@/components/collections/GenerationPanel'
import { PricingPanel } from '@/components/collections/PricingPanel'
import { FeatureConfigProvider } from '@/lib/features'
import { visibleNavigation } from '@/lib/navigation'

const authState = vi.hoisted(() => ({ user: null as { role: string } | null }))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: authState.user }) }))
vi.mock('@/lib/api/dues', () => ({
  getDuesPrices: vi.fn(() => new Promise(() => undefined)),
  createDuesPrice: vi.fn(),
  revokeDuesPrice: vi.fn(),
  generateDuesAssessments: vi.fn(),
}))
const { default: CollectionsPage } = await import('./page')

const renderPage = (enabled: boolean, role: string) => {
  authState.user = { role }
  return render(
    <FeatureConfigProvider collectionsEnabled={enabled}>
      <CollectionsPage />
    </FeatureConfigProvider>,
  )
}

describe('Collections navigation and direct access', () => {
  it('shows enabled ADMIN/TESORERO navigation and denies disabled or other roles', () => {
    const admin = { role: 'ADMIN', permissions: { data_steward: false } } as never
    const consulta = { role: 'CONSULTA', permissions: { data_steward: false } } as never
    expect(visibleNavigation(admin, { collectionsEnabled: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ href: '/collections' })]),
    )
    expect(visibleNavigation(consulta, { collectionsEnabled: true })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ href: '/collections' })]),
    )
    expect(visibleNavigation(admin, { collectionsEnabled: false })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ href: '/collections' })]),
    )
  })

  it('denies direct access when disabled or unauthorized', () => {
    renderPage(false, 'ADMIN')
    expect(screen.getByText('Collections is currently disabled.')).toBeInTheDocument()
    renderPage(true, 'OPERADOR')
    expect(screen.getByText('You do not have permission to use Collections.')).toBeInTheDocument()
  })

  it('exposes labelled landmarks for an authorized operator', () => {
    renderPage(true, 'TESORERO')
    expect(screen.getByRole('main', { name: /collections/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^collections$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /collections workspace/i })).toBeInTheDocument()
  })

  it('keeps generation available to TESORERO while withholding ADMIN pricing controls', () => {
    renderPage(true, 'TESORERO')
    expect(screen.getByRole('heading', { name: /monthly generation/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save price' })).not.toBeInTheDocument()
    expect(screen.getByRole('main')).not.toHaveTextContent(/ctacte|reconciliation/i)
  })
})

describe('Collections pricing and generation panels', () => {
  it('retains the pricing draft and announces an overlap conflict', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'CONFLICT', 'Price effective interval conflicts'))
    render(
      <PricingPanel
        prices={[]}
        state="conflict"
        error="Price effective interval conflicts"
        onCreate={onCreate}
      />,
    )

    await user.type(screen.getByLabelText('Amount (cents)'), '12500')
    await user.type(screen.getByLabelText('Effective from'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Save price' }))

    expect(screen.getByLabelText('Amount (cents)')).toHaveValue(12500)
    expect(screen.getByLabelText('Effective from')).toHaveValue('2026-01-01')
    expect(screen.getByRole('alert')).toHaveTextContent(/conflicts/i)
  })

  it.each([
    ['empty', 'No prices configured.'],
    ['unavailable', 'Pricing is unavailable.'],
    ['success', 'Price saved.'],
  ] as const)('renders the pricing %s state', (state, message) => {
    render(<PricingPanel prices={[]} state={state} onCreate={vi.fn()} />)
    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it.each([
    ['created', 'Generation completed.'],
    ['replayed', 'Generation replayed.'],
    ['zero', 'No obligations were generated.'],
    ['conflict', 'Generation needs review.'],
  ] as const)('renders the generation %s state', (status, message) => {
    render(<GenerationPanel status={status} onGenerate={vi.fn()} />)
    expect(screen.getByText(message)).toBeInTheDocument()
  })
})
