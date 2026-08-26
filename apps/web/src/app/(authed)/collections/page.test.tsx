import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { PricingPanel } from '@/components/collections/PricingPanel'
import { FeatureConfigProvider } from '@/lib/features'
import { visibleNavigation } from '@/lib/navigation'

const authState = vi.hoisted(() => ({ user: null as { role: string } | null }))
const duesMocks = vi.hoisted(() => ({
  getDuesPrices: vi.fn(() => new Promise(() => undefined)),
  createDuesPrice: vi.fn(),
  revokeDuesPrice: vi.fn(),
  previewDuesAssessments: vi.fn(),
  getDebt: vi.fn(),
  getObligationAgreements: vi.fn(),
  createNegotiatedAgreement: vi.fn(),
  reviseNegotiatedAgreement: vi.fn(),
  createCommunityWorkEvidence: vi.fn(),
  DuesOperationError: class MockDuesOperationError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message)
    }
  },
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

  it('refreshes lineage and debt after a stale revision and resubmits with a new key', async () => {
    duesMocks.getDebt.mockClear()
    duesMocks.getObligationAgreements.mockClear()
    duesMocks.reviseNegotiatedAgreement.mockClear()
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
    const active = {
      id: 'agreement-1',
      socio_id: 'socio-1',
      obligation_id: 'obligation-1',
      kind: 'NEGOTIATED',
      status: 'ACTIVE',
      revision_number: 1,
      terms_version: 1,
      terms: { narrative: 'Narrativa vigente' },
      reason: 'Motivo original',
      revision_reason: null,
      agreement_date: '2026-01-03',
      revision_of_agreement_id: null,
      replayed: false,
    }
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue(debt)
    duesMocks.getObligationAgreements.mockResolvedValue({ active, revisions: [active] })
    duesMocks.reviseNegotiatedAgreement
      .mockRejectedValueOnce(new duesMocks.DuesOperationError('conflict', 'conflict'))
      .mockResolvedValueOnce({ ...active, revision_number: 2, replayed: false })

    renderPage(true, 'ADMIN', true)
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.click(await screen.findByRole('button', { name: 'Revisar acuerdo activo' }))
    await user.clear(screen.getByLabelText(/narrativa del acuerdo/i))
    await user.type(screen.getByLabelText(/narrativa del acuerdo/i), 'Nueva narrativa')
    await user.type(screen.getByLabelText(/motivo de la revisión/i), 'Cambio acordado')
    await user.click(screen.getByRole('button', { name: /actualizar acuerdo/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/cambió/i)
    expect(duesMocks.getObligationAgreements).toHaveBeenCalledTimes(2)
    expect(duesMocks.getDebt).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: /revisar acuerdo actualizado/i }))
    await user.click(screen.getByRole('button', { name: /actualizar acuerdo/i }))

    expect(duesMocks.reviseNegotiatedAgreement).toHaveBeenCalledTimes(2)
    expect(duesMocks.reviseNegotiatedAgreement.mock.calls[0]![2]).not.toBe(
      duesMocks.reviseNegotiatedAgreement.mock.calls[1]![2],
    )
    expect(duesMocks.reviseNegotiatedAgreement).toHaveBeenLastCalledWith(
      'agreement-1',
      { terms: { narrative: 'Nueva narrativa' }, reason: 'Cambio acordado' },
      expect.any(String),
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

  it('keeps read-only assessment preview available to TESORERO while withholding ADMIN pricing controls', () => {
    renderPage(true, 'TESORERO')
    expect(screen.getByRole('heading', { name: /vista previa de evaluación/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cuota' })).not.toBeInTheDocument()
    expect(screen.getByRole('main')).not.toHaveTextContent(/ctacte|reconciliation/i)
  })

  it('requests a selected member preview and announces malformed responses without execution controls', async () => {
    const user = userEvent.setup()
    const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue({ status: 'empty', obligations: [] })
    duesMocks.previewDuesAssessments.mockRejectedValue(
      new duesMocks.DuesOperationError('partial_data', 'malformed preview'),
    )

    renderPage(true, 'TESORERO')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.type(screen.getByLabelText('Desde'), '2026-01')
    await user.type(screen.getByLabelText('Hasta'), '2026-02')
    await user.click(screen.getByRole('button', { name: 'Consultar vista previa' }))

    await waitFor(() =>
      expect(duesMocks.previewDuesAssessments).toHaveBeenCalledWith({
        socio_id: 'socio-1',
        from_period: '2026-01',
        through_period: '2026-02',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/datos incompletos/i)
    expect(
      screen.queryByRole('button', { name: /ejecutar|generar|confirmar/i }),
    ).not.toBeInTheDocument()
  })
})

describe('Collections pricing panel', () => {
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
})

describe('community-work evidence settlement', () => {
  const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
  // prettier-ignore
  const active = { id: 'agreement-1', socio_id: 'socio-1', obligation_id: 'obligation-1', kind: 'NEGOTIATED', status: 'ACTIVE', revision_number: 1, terms_version: 1, terms: { narrative: 'Trabajo acordado' }, reason: 'Acuerdo vigente', revision_reason: null, agreement_date: '2026-01-03', revision_of_agreement_id: null, replayed: false }
  // prettier-ignore
  const debt = (outstanding = 10_000) => ({ status: 'ready', socio_id: 'socio-1', currency: 'ARS', total_debt_cents: outstanding, obligations: [{ id: 'obligation-1', period_start: '2026-01-01', period_end: '2026-02-01', original_amount_cents: 10_000, outstanding_cents: outstanding, currency: 'ARS', status: outstanding ? 'OPEN' : 'PAID', components: [], benefits: [], allocations: [] }] })
  // prettier-ignore
  const communityResult = (replayed = false) => ({ community_work_id: 'work-1', settlement_id: 'settlement-1', allocation_id: 'allocation-1', obligation_id: 'obligation-1', agreement_id: 'agreement-1', amount_cents: 2_500, currency: 'ARS', replayed })
  // prettier-ignore
  const prepare = () => { vi.clearAllMocks(); duesMocks.getDebt.mockResolvedValueOnce(debt()).mockResolvedValueOnce(debt(7_500)); duesMocks.getObligationAgreements.mockResolvedValue({ active, revisions: [active] }); sociosMocks.getSocios.mockResolvedValue({ items: [socio] }) }
  // prettier-ignore
  const openForm = async () => { const user = userEvent.setup(); renderPage(true, 'ADMIN', true); await user.type(screen.getByLabelText('Buscar socio'), 'Ana'); await user.click(screen.getByRole('button', { name: 'Buscar socio' })); await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ })); await user.click(await screen.findByRole('button', { name: /registrar trabajo comunitario/i })); return user }
  // prettier-ignore
  const completeDraft = async (user: ReturnType<typeof userEvent.setup>) => { await user.type(screen.getByLabelText(/valor aprobado/i), '2500'); await user.type(screen.getByLabelText(/evidencia/i), 'Acta 12 aprobada'); await user.type(screen.getByLabelText(/motivo/i), 'Trabajo aceptado'); await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i })) }

  it('links the active agreement, reuses the draft key, and refreshes debt only after confirmation', async () => {
    prepare()
    duesMocks.createCommunityWorkEvidence.mockResolvedValue(communityResult())
    const user = await openForm()
    await completeDraft(user)

    await waitFor(() => expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(1))
    expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        socio_id: 'socio-1',
        obligation_id: 'obligation-1',
        agreement_id: 'agreement-1',
        amount_cents: 2_500,
        evidence: { description: 'Acta 12 aprobada' },
        reason: 'Trabajo aceptado',
      }),
      expect.any(String),
    )
    expect(duesMocks.getDebt).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Deuda total pendiente: 75.00 ARS')).toBeInTheDocument()
  })

  it.each([
    ['conflict', 'El saldo cambió', false],
    ['permission', 'No tenés permiso para registrar trabajo comunitario.', false],
    ['partial_data', 'Los datos del trabajo comunitario están incompletos.', false],
    ['unavailable', 'No se pudo registrar el trabajo comunitario. Intentá nuevamente.', false],
    ['replayed', 'Este trabajo comunitario ya había sido registrado.', true],
  ] as const)(
    'handles %s without an unconfirmed debt refresh and preserves the draft',
    async (kind, message, confirmed) => {
      prepare()
      if (confirmed) {
        duesMocks.createCommunityWorkEvidence.mockResolvedValue(communityResult(true))
      } else {
        duesMocks.createCommunityWorkEvidence.mockRejectedValue(
          new duesMocks.DuesOperationError(kind, kind),
        )
      }
      const user = await openForm()
      const evidence = screen.getByLabelText(/evidencia/i)
      await completeDraft(user)

      await waitFor(() =>
        expect(screen.getByText((content) => content.includes(message))).toBeInTheDocument(),
      )
      expect(evidence).toHaveValue('Acta 12 aprobada')
      expect(duesMocks.getDebt).toHaveBeenCalledTimes(confirmed ? 2 : 1)
    },
  )

  it('abandons a conflict key and uses a new idempotency key only on explicit resubmission', async () => {
    prepare()
    duesMocks.createCommunityWorkEvidence
      .mockRejectedValueOnce(new duesMocks.DuesOperationError('conflict', 'conflict'))
      .mockResolvedValueOnce(communityResult())
    const user = await openForm()
    await completeDraft(user)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/saldo cambió/i))
    const firstKey = duesMocks.createCommunityWorkEvidence.mock.calls[0]![1]
    await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i }))
    await waitFor(() => expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(2))

    expect(duesMocks.createCommunityWorkEvidence.mock.calls[1]![1]).not.toBe(firstKey)
    expect(duesMocks.getDebt).toHaveBeenCalledTimes(2)
  })
})
