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
  getDebt: vi.fn(),
  getObligationAgreements: vi.fn(),
  createNegotiatedAgreement: vi.fn(),
}))
const padronesMocks = vi.hoisted(() => ({
  getDisciplinas: vi.fn(() => new Promise(() => undefined)),
}))
const sociosMocks = vi.hoisted(() => ({
  getSocios: vi.fn(),
}))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: authState.user }) }))
vi.mock('@/lib/api/dues', () => duesMocks)
vi.mock('@/lib/api/padrones', () => padronesMocks)
vi.mock('@/lib/api/socios', () => sociosMocks)
const { default: CollectionsPage } = await import('./page')

const renderPage = (enabled: boolean | undefined, role: string, agreementsEnabled = false) => {
  authState.user = { role }
  return render(
    <FeatureConfigProvider
      {...(enabled === undefined ? {} : { collectionsEnabled: enabled })}
      agreementsEnabled={agreementsEnabled}
    >
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

  it('requires both Collections Web and agreements flags for agreement actions', async () => {
    const user = userEvent.setup()
    const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    const debt = {
      status: 'ready',
      socio_id: 'socio-1',
      currency: 'ARS',
      total_debt_cents: 10_000,
      obligations: [
        {
          id: 'obligation-1',
          period_start: '2026-01-01',
          period_end: '2026-02-01',
          original_amount_cents: 10_000,
          outstanding_cents: 10_000,
          currency: 'ARS',
          status: 'OPEN',
          components: [],
          benefits: [],
          allocations: [],
        },
      ],
    }
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue(debt)
    duesMocks.getObligationAgreements.mockResolvedValue({ active: null, revisions: [] })

    const disabledView = renderPage(true, 'ADMIN', false)
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await waitFor(() => expect(duesMocks.getDebt).toHaveBeenCalledWith('socio-1'))
    expect(screen.queryByRole('button', { name: 'Registrar acuerdo' })).not.toBeInTheDocument()

    disabledView.unmount()
    renderPage(true, 'ADMIN', true)
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Registrar acuerdo' })).toBeInTheDocument(),
    )
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
    expect(screen.getByRole('heading', { name: /generación mensual/i })).toBeInTheDocument()
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
    ['created', 'Se generaron las deudas del período.'],
    ['replayed', 'El período ya estaba generado.'],
    ['zero', 'No se generaron deudas.'],
    ['conflict', 'La generación requiere revisión.'],
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

  it('submits a base fee without a discipline', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<PricingPanel prices={[]} onCreate={onCreate} />)

    await user.type(screen.getByLabelText('Importe (centavos)'), '12500')
    await user.type(screen.getByLabelText('Vigente desde'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'BASE', disciplina_id: null }),
    )
    expect(screen.queryByLabelText('Disciplina')).not.toBeInTheDocument()
  })

  it.each([
    ['loading', 'Cargando disciplinas…'],
    ['empty', 'No hay disciplinas disponibles.'],
    ['error', 'No se pudieron cargar las disciplinas.'],
  ] as const)('renders the discipline %s state in Spanish', (disciplineState, message) => {
    render(
      <PricingPanel
        prices={[]}
        disciplines={[]}
        disciplineState={disciplineState}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('shows generation evidence and a direct continuation to debt detail', () => {
    render(
      <GenerationPanel
        status="created"
        result={{ period: '2026-01', obligation_ids: ['deuda-1', 'deuda-2'] }}
        onGenerate={vi.fn()}
      />,
    )

    expect(screen.getByText(/2 obligaciones/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver detalle de deudas/i })).toHaveAttribute(
      'href',
      '#debt-title',
    )
  })
})
