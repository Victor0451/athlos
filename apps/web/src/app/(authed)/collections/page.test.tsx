import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { PricingPanel } from '@/components/collections/PricingPanel'
import type { CurrentUser } from '@/lib/auth'
import type { CondonationLifecyclePage } from '@/lib/api/condonation'
import { FeatureConfigProvider } from '@/lib/features'
import { visibleNavigation } from '@/lib/navigation'

const authState = vi.hoisted(() => ({ user: null as { role: string; operator_id: string } | null }))
const duesMocks = vi.hoisted(() => ({
  getDuesPrices: vi.fn(() => new Promise(() => undefined)),
  createDuesPrice: vi.fn(),
  revokeDuesPrice: vi.fn(),
  previewDuesAssessments: vi.fn(),
  planDuesGeneration: vi.fn(),
  generateDuesAssessments: vi.fn(),
  getDebt: vi.fn(),
  getObligationAgreements: vi.fn(),
  createNegotiatedAgreement: vi.fn(),
  reviseNegotiatedAgreement: vi.fn(),
  createCommunityWorkEvidence: vi.fn(),
  createFullSelectionPayment: vi.fn(),
  reverseDuesSettlement: vi.fn(),
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
const treasuryMocks = vi.hoisted(() => ({
  getOpenCashShifts: vi.fn(),
}))
const condonationMocks = vi.hoisted(() => ({
  createCondonationRequest: vi.fn(),
  decideCondonationRequest: vi.fn(),
  executeCondonationRequest: vi.fn(),
  listCondonationLifecycle: vi.fn<() => Promise<CondonationLifecyclePage>>(() =>
    Promise.resolve({ items: [] }),
  ),
  CondonationOperationError: class MockCondonationOperationError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message)
    }
  },
}))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: authState.user }) }))
vi.mock('@/lib/api/dues', () => duesMocks)
vi.mock('@/lib/api/padrones', () => padronesMocks)
vi.mock('@/lib/api/socios', () => sociosMocks)
vi.mock('@/lib/api/treasury', () => treasuryMocks)
vi.mock('@/lib/api/condonation', () => condonationMocks)
const { default: CollectionsPage } = await import('./page')

const renderPage = (enabled: boolean | undefined, role: string, agreementsEnabled = false) => {
  authState.user = { role, operator_id: 'operator-1' }
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
  beforeEach(() => {
    sessionStorage.clear()
    condonationMocks.listCondonationLifecycle.mockReset()
    condonationMocks.listCondonationLifecycle.mockResolvedValue({ items: [] })
    duesMocks.getDebt.mockReset()
    duesMocks.getObligationAgreements.mockReset()
    sociosMocks.getSocios.mockReset()
    treasuryMocks.getOpenCashShifts.mockReset()
    treasuryMocks.getOpenCashShifts.mockResolvedValue([])
  })

  it('shows lifecycle loading for the selected member', async () => {
    const user = userEvent.setup()
    const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue({ status: 'ready', socio_id: socio.id, obligations: [] })
    condonationMocks.listCondonationLifecycle.mockImplementation(() => new Promise(() => undefined))

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))

    expect(
      await screen.findByRole('status', { name: 'Estado del historial de condonaciones' }),
    ).toHaveTextContent('Cargando historial de condonaciones.')
  })

  it('shows an authoritative empty lifecycle result as ready', async () => {
    const user = userEvent.setup()
    const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue({ status: 'ready', socio_id: socio.id, obligations: [] })
    condonationMocks.listCondonationLifecycle.mockResolvedValue({ items: [] })

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))

    expect(
      await screen.findByRole('status', { name: 'Estado del historial de condonaciones' }),
    ).toHaveTextContent('No hay solicitudes de condonación para este socio.')
  })

  it('shows a lifecycle failure alert with a member-safe retry that does not refresh debt', async () => {
    const user = userEvent.setup()
    const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue({ status: 'ready', socio_id: socio.id, obligations: [] })
    condonationMocks.listCondonationLifecycle
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [] })

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar el historial de condonaciones.',
    )

    const debtCalls = duesMocks.getDebt.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Reintentar historial de condonaciones' }))
    await waitFor(() => expect(condonationMocks.listCondonationLifecycle).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Estado del historial de condonaciones' }),
      ).toHaveTextContent('No hay solicitudes de condonación para este socio.'),
    )
    expect(duesMocks.getDebt).toHaveBeenCalledTimes(debtCalls)
  })

  it('does not let a stale lifecycle failure overwrite the newer selected member', async () => {
    const user = userEvent.setup()
    let rejectFirst!: (reason?: unknown) => void
    const first = new Promise<CondonationLifecyclePage>((_resolve, reject) => {
      rejectFirst = reject
    })
    const ana = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    const beto = { id: 'socio-2', nombre: 'Beto', apellido: 'López', numero_socio: '43' }
    sociosMocks.getSocios.mockResolvedValue({ items: [ana, beto] })
    duesMocks.getDebt.mockResolvedValue({ status: 'ready', socio_id: ana.id, obligations: [] })
    condonationMocks.listCondonationLifecycle
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ items: [] })

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'a')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.click(screen.getByRole('button', { name: /López, Beto/ }))
    await screen.findByRole('status', { name: 'Estado del historial de condonaciones' })
    rejectFirst(new Error('stale offline'))

    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Estado del historial de condonaciones' }),
      ).toHaveTextContent('No hay solicitudes de condonación para este socio.'),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refreshes lifecycle before debt only after its approved execution becomes executed', async () => {
    const user = userEvent.setup()
    const memberId = '00000000-0000-4000-8000-000000000003'
    const requestId = '00000000-0000-4000-8000-000000000001'
    const executionId = '00000000-0000-4000-8000-000000000002'
    const obligationId = '00000000-0000-4000-8000-000000000004'
    const socio = { id: memberId, nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    const debt = {
      status: 'ready',
      socio_id: memberId,
      currency: 'ARS',
      total_debt_cents: 100,
      obligations: [
        {
          id: obligationId,
          period_start: '2026-01-01',
          period_end: '2026-02-01',
          original_amount_cents: 100,
          outstanding_cents: 100,
          currency: 'ARS',
          status: 'OPEN',
          components: [],
          benefits: [],
          allocations: [],
        },
      ],
    }
    const lifecycle: CondonationLifecyclePage['items'][number] = {
      id: requestId,
      state: 'approved_awaiting_execution',
      expires_at: '2026-02-01T00:00:00.000Z',
      decided_at: '2026-01-31T00:00:00.000Z',
      execution_id: executionId,
      execution_status: 'recoverable',
      snapshot: {
        member_id: memberId,
        obligations: [
          { obligation_id: obligationId, currency: 'ARS', outstanding_amount_cents: 100 },
        ],
      },
    }
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue(debt)
    condonationMocks.listCondonationLifecycle
      .mockResolvedValueOnce({ items: [lifecycle] })
      .mockResolvedValueOnce({
        items: [{ ...lifecycle, state: 'executed', execution_status: 'executed' }],
      })
    condonationMocks.executeCondonationRequest.mockResolvedValue({ status: 'replayed' })

    const debtCalls = duesMocks.getDebt.mock.calls.length
    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.click(await screen.findByRole('button', { name: /ejecutar condonación/i }))

    await waitFor(() =>
      expect(condonationMocks.executeCondonationRequest).toHaveBeenCalledWith(
        requestId,
        executionId,
        expect.any(String),
      ),
    )
    await waitFor(() => expect(duesMocks.getDebt).toHaveBeenCalledTimes(debtCalls + 2))
  })

  it('shows enabled ADMIN/TESORERO navigation and denies disabled or other roles', () => {
    const admin: CurrentUser = {
      operator_id: 'operator-1',
      role: 'ADMIN',
      username: 'admin',
      permissions: { can_reprint: false, can_anulate: false, data_steward: false },
    }
    const consulta: CurrentUser = { ...admin, role: 'CONSULTA' }
    expect(visibleNavigation(admin, { collectionsEnabled: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ href: '/collections' })]),
    )
    expect(visibleNavigation({ ...admin, role: 'OPERADOR' }, { collectionsEnabled: true })).toEqual(
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

  it('denies direct access when disabled but admits OPERADOR to request-only Collections', () => {
    renderPage(false, 'ADMIN')
    expect(screen.getByText('La cobranza está deshabilitada actualmente.')).toBeInTheDocument()
    renderPage(true, 'OPERADOR')
    expect(screen.getByRole('main', { name: /cobranza/i })).toBeInTheDocument()
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

  it('renders one treatment workspace for ready debt without duplicating its controls in the debt detail', async () => {
    const user = userEvent.setup()
    const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
    duesMocks.getDebt.mockResolvedValue({
      status: 'ready',
      socio_id: socio.id,
      currency: 'ARS',
      total_debt_cents: 10_000,
      obligations: [],
    })
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })

    renderPage(true, 'ADMIN', true)
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))

    expect(await screen.findAllByRole('region', { name: 'Tratamientos de deuda' })).toHaveLength(1)
    const debtDetail = screen.getByRole('region', { name: 'Detalle de deuda' })
    expect(
      within(debtDetail).queryByRole('button', { name: 'Registrar pago' }),
    ).not.toBeInTheDocument()
    expect(
      within(debtDetail).queryByRole('button', { name: 'Registrar acuerdo' }),
    ).not.toBeInTheDocument()
    expect(
      within(debtDetail).queryByRole('button', { name: 'Solicitar condonación' }),
    ).not.toBeInTheDocument()
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
})

describe('payment orchestration and recovery', () => {
  const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
  const shift = { id: 'shift-1', desk_id: 'desk-1', business_date: '2026-01-15' }
  // prettier-ignore
  const debt = { status: 'ready' as const, socio_id: socio.id, currency: 'ARS', total_debt_cents: 10_000, obligations: [{ id: 'obligation-1', period_start: '2026-01-01', period_end: '2026-02-01', original_amount_cents: 10_000, outstanding_cents: 10_000, currency: 'ARS', status: 'OPEN' as const, components: [], benefits: [], allocations: [] }] }
  const prepare = () => {
    vi.clearAllMocks()
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue(debt)
    treasuryMocks.getOpenCashShifts.mockResolvedValue([shift])
  }
  const openPayment = async () => {
    const user = userEvent.setup()
    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    const registerPayment = await screen.findByRole('button', { name: 'Registrar pago' })
    await waitFor(() => expect(registerPayment).toBeEnabled())
    await user.click(registerPayment)
    return user
  }

  it('submits the default full selection with Transferencia, then refreshes debt and completes its key', async () => {
    prepare()
    duesMocks.createFullSelectionPayment.mockResolvedValue({ settlement_id: 'settlement-1' })
    const user = await openPayment()
    await user.click(screen.getByLabelText('Transferencia'))
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }))

    await waitFor(() => expect(duesMocks.createFullSelectionPayment).toHaveBeenCalledTimes(1))
    expect(duesMocks.createFullSelectionPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        socio_id: socio.id,
        obligation_ids: ['obligation-1'],
        shift_id: shift.id,
        tender: 'TRANSFER',
        selection_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.any(String),
    )
    await waitFor(() => expect(duesMocks.getDebt).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Pago registrado.')).toBeInTheDocument()
    expect(sessionStorage.getItem('athlos:collections:idempotency')).toBeNull()
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

    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '125')
    await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(screen.getByLabelText('Importe mensual (ARS)')).toHaveValue('125')
    expect(screen.getByLabelText('Vigente desde')).toHaveValue('01/01/2026')
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
    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '35')
    await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SPORT', disciplina_id: 'disciplina-1' }),
    )
  })

  it('submits a base fee without a discipline', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<PricingPanel prices={[]} onCreate={onCreate} />)

    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '125')
    await user.type(screen.getByLabelText('Vigente desde'), '01/01/2026')
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
  const completeDraft = async (user: ReturnType<typeof userEvent.setup>) => { await user.type(screen.getByLabelText(/valor aprobado/i), '2500'); await user.type(screen.getByLabelText('Evidencia del trabajo aceptado'), 'Acta 12 aprobada'); await user.type(screen.getByLabelText('Motivo de la aceptación'), 'Trabajo aceptado'); await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i })) }

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
    expect(screen.getByText('Deuda total pendiente: $ 75,00')).toBeInTheDocument()
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
      const evidence = screen.getByLabelText('Evidencia del trabajo aceptado')
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
