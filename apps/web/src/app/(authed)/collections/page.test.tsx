import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { GenerationPanel } from '@/components/collections/GenerationPanel'
import { PricingPanel } from '@/components/collections/PricingPanel'
import { FeatureConfigProvider } from '@/lib/features'
import { visibleNavigation } from '@/lib/navigation'

const authState = vi.hoisted(() => ({ user: null as { role: string } | null }))
const duesMocks = vi.hoisted(() => ({
  getDuesPrices: vi.fn(() => new Promise(() => undefined)),
  createDuesPrice: vi.fn(),
  revokeDuesPrice: vi.fn(),
  generateDuesAssessments: vi.fn(),
}))
const padronesMocks = vi.hoisted(() => ({
  getDisciplinas: vi.fn(() => new Promise(() => undefined)),
}))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: authState.user }) }))
vi.mock('@/lib/api/dues', () => duesMocks)
vi.mock('@/lib/api/padrones', () => padronesMocks)
const { default: CollectionsPage } = await import('./page')

const renderPage = (enabled: boolean | undefined, role: string) => {
  authState.user = { role }
  return render(
    <FeatureConfigProvider {...(enabled === undefined ? {} : { collectionsEnabled: enabled })}>
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

  it('denies direct access by default', () => {
    renderPage(undefined, 'ADMIN')
    expect(screen.getByText('La cobranza está deshabilitada actualmente.')).toBeInTheDocument()
  })

  it('denies direct access when disabled or unauthorized', () => {
    renderPage(false, 'ADMIN')
    expect(screen.getByText('La cobranza está deshabilitada actualmente.')).toBeInTheDocument()
    renderPage(true, 'OPERADOR')
    expect(screen.getByText('No tenés permiso para usar la cobranza.')).toBeInTheDocument()
  })

  it('exposes labelled landmarks for an authorized operator', () => {
    renderPage(true, 'TESORERO')
    expect(screen.getByRole('main', { name: /cobranza/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^cobranza$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: /espacio de trabajo de cobranzas/i }),
    ).toBeInTheDocument()
  })

  it('keeps generation available to TESORERO while withholding ADMIN pricing controls', () => {
    renderPage(true, 'TESORERO')
    expect(screen.getByRole('heading', { name: /monthly generation/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cuota' })).not.toBeInTheDocument()
    expect(screen.getByRole('main')).not.toHaveTextContent(/ctacte|reconciliation/i)
  })
})

describe('Collections pricing and generation panels', () => {
  it('retains the pricing draft and announces an overlap conflict', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'CONFLICT', 'El intervalo de vigencia se superpone'))
    render(
      <PricingPanel
        prices={[]}
        state="conflict"
        error="El intervalo de vigencia se superpone"
        onCreate={onCreate}
      />,
    )

    await user.type(screen.getByLabelText('Importe (centavos)'), '12500')
    await user.type(screen.getByLabelText('Vigente desde'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(screen.getByLabelText('Importe (centavos)')).toHaveValue(12500)
    expect(screen.getByLabelText('Vigente desde')).toHaveValue('2026-01-01')
    expect(screen.getByRole('alert')).toHaveTextContent(/superpone/i)
  })

  it.each([
    ['empty', 'No hay cuotas configuradas.'],
    ['unavailable', 'La configuración de cuotas no está disponible.'],
    ['success', 'Cuota guardada.'],
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

  it('loads named discipline options from the existing padrones source', async () => {
    padronesMocks.getDisciplinas.mockResolvedValue({
      items: [{ id: 'disciplina-1', codigo: 'NATACION', nombre: 'Natación' }],
    })

    renderPage(true, 'ADMIN')

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Adicional por disciplina' })).toBeInTheDocument(),
    )
    await userEvent.setup().selectOptions(screen.getByLabelText('Tipo de cuota'), 'SPORT')
    expect(screen.getByRole('option', { name: 'Natación' })).toBeInTheDocument()
  })

  it('submits the selected discipline id for a sport addition', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <PricingPanel
        prices={[]}
        disciplines={[{ id: 'disciplina-1', codigo: 'NATACION', nombre: 'Natación' }]}
        disciplineState="ready"
        onCreate={onCreate}
      />,
    )

    await user.selectOptions(screen.getByLabelText('Tipo de cuota'), 'SPORT')
    await user.selectOptions(screen.getByLabelText('Disciplina'), 'disciplina-1')
    await user.type(screen.getByLabelText('Importe (centavos)'), '3500')
    await user.type(screen.getByLabelText('Vigente desde'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SPORT', disciplina_id: 'disciplina-1' }),
    )
  })
})
