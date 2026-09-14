import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentUser } from '@/lib/auth'
import type { CondonationLifecyclePage } from '@/lib/api/condonation'
import { FeatureConfigProvider } from '@/lib/features'
import { visibleNavigation } from '@/lib/navigation'

const authState = vi.hoisted(() => ({ user: null as { role: string; operator_id: string } | null }))
const navigationMocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}))
const duesMocks = vi.hoisted(() => ({
  getDuesPrices: vi.fn(() => new Promise(() => undefined)),
  createDuesPrice: vi.fn(),
  revokeDuesPrice: vi.fn(),
  previewDuesAssessments: vi.fn(),
  executeDuesAssessmentRange: vi.fn(),
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
  getSocio: vi.fn(),
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationMocks.push, replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.params,
}))
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    sessionStorage.clear()
    navigationMocks.params = new URLSearchParams()
    navigationMocks.push.mockReset()
    navigationMocks.replace.mockReset()
    condonationMocks.listCondonationLifecycle.mockReset()
    condonationMocks.listCondonationLifecycle.mockResolvedValue({ items: [] })
    duesMocks.getDebt.mockReset()
    duesMocks.getObligationAgreements.mockReset()
    sociosMocks.getSocios.mockReset()
    sociosMocks.getSocio.mockReset()
    treasuryMocks.getOpenCashShifts.mockReset()
    treasuryMocks.getOpenCashShifts.mockResolvedValue([])
  })

  it('ignores malformed cash context without loading a member or posting', async () => {
    navigationMocks.params = new URLSearchParams('cash_member=invalid&cash_obligations=invalid')
    renderPage(true, 'ADMIN')

    await waitFor(() => expect(sociosMocks.getSocio).not.toHaveBeenCalled())
    expect(duesMocks.createFullSelectionPayment).not.toHaveBeenCalled()
  })

  const handoff = {
    memberId: '00000000-0000-4000-8000-000000000001',
    requestId: '00000000-0000-4000-8000-000000000002',
    obligationId: '00000000-0000-4000-8000-000000000004',
  }
  const handoffQuery = () =>
    `condonation_member=${handoff.memberId}&condonation_request=${handoff.requestId}`
  const handoffSocio = (id = handoff.memberId) => ({
    id,
    nombre: 'Ana',
    apellido: 'Gorriti',
    numero_socio: '42',
  })
  const handoffDebt = (id = handoff.memberId) => ({
    status: 'ready',
    socio_id: id,
    currency: 'ARS',
    total_debt_cents: 100,
    obligations: [
      {
        id: handoff.obligationId,
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
  })
  const handoffLifecycle = (
    state:
      | 'pending'
      | 'rejected'
      | 'expired'
      | 'approved_awaiting_execution'
      | 'executed' = 'approved_awaiting_execution',
  ) =>
    ({
      id: handoff.requestId,
      state,
      expires_at: '2030-02-01T00:00:00.000Z',
      decided_at: state === 'pending' ? null : '2026-01-31T00:00:00.000Z',
      execution_id:
        state === 'approved_awaiting_execution' || state === 'executed'
          ? '00000000-0000-4000-8000-000000000003'
          : null,
      execution_status:
        state === 'executed'
          ? 'executed'
          : state === 'approved_awaiting_execution'
            ? 'recoverable'
            : 'unavailable',
      snapshot: {
        member_id: handoff.memberId,
        obligations: [
          {
            obligation_id: handoff.obligationId,
            currency: 'ARS',
            outstanding_amount_cents: 100,
          },
        ],
      },
    }) as CondonationLifecyclePage['items'][number]

  it('opens the exact approved lifecycle without selecting payment or executing it', async () => {
    navigationMocks.params = new URLSearchParams(`keep=one&${handoffQuery()}&tag=first&tag=second`)
    sociosMocks.getSocio.mockResolvedValue(handoffSocio())
    duesMocks.getDebt.mockResolvedValue(handoffDebt())
    condonationMocks.listCondonationLifecycle.mockResolvedValue({ items: [handoffLifecycle()] })
    renderPage(true, 'ADMIN')

    const lifecycle = await screen.findByRole('region', { name: 'Estado de la condonación' })
    await waitFor(() => expect(lifecycle).toHaveFocus())
    expect(navigationMocks.replace).toHaveBeenCalledWith(
      '/collections?keep=one&tag=first&tag=second',
      { scroll: false },
    )
    expect(
      screen.getByRole('status', { name: 'Acceso contextual de condonación' }),
    ).toHaveTextContent(/aprobada.*ejecución sigue siendo explícita/i)
    expect(screen.getByRole('button', { name: /Recuperar y ejecutar condonación/ })).toBeEnabled()
    expect(condonationMocks.executeCondonationRequest).not.toHaveBeenCalled()
    expect(duesMocks.createFullSelectionPayment).not.toHaveBeenCalled()
  })

  it.each([
    ['pending', /todavía está pendiente/],
    ['rejected', /fue rechazada/],
    ['expired', /venció/],
    ['executed', /ya fue ejecutada/],
  ] as const)('shows the fresh %s state without triggering an action', async (state, copy) => {
    navigationMocks.params = new URLSearchParams(handoffQuery())
    sociosMocks.getSocio.mockResolvedValue(handoffSocio())
    duesMocks.getDebt.mockResolvedValue(handoffDebt())
    condonationMocks.listCondonationLifecycle.mockResolvedValue({
      items: [handoffLifecycle(state)],
    })
    renderPage(true, 'ADMIN')
    expect(
      await screen.findByRole('status', { name: 'Acceso contextual de condonación' }),
    ).toHaveTextContent(copy)
    expect(condonationMocks.executeCondonationRequest).not.toHaveBeenCalled()
    expect(duesMocks.createFullSelectionPayment).not.toHaveBeenCalled()
  })

  it.each([
    ['condonation_member=invalid', 'ADMIN', true],
    [handoffQuery(), 'CONSULTA', true],
    [handoffQuery(), 'ADMIN', false],
  ])(
    'cleans a disallowed or malformed handoff without fetching: %s',
    async (query, role, enabled) => {
      navigationMocks.params = new URLSearchParams(`before=one&${query}&after=two`)
      renderPage(enabled, role)
      await waitFor(() =>
        expect(navigationMocks.replace).toHaveBeenCalledWith('/collections?before=one&after=two', {
          scroll: false,
        }),
      )
      expect(sociosMocks.getSocio).not.toHaveBeenCalled()
      expect(condonationMocks.listCondonationLifecycle).not.toHaveBeenCalled()
      expect(condonationMocks.executeCondonationRequest).not.toHaveBeenCalled()
    },
  )

  it('reports member and lifecycle mismatches without exposing an action', async () => {
    navigationMocks.params = new URLSearchParams(handoffQuery())
    sociosMocks.getSocio.mockResolvedValue(handoffSocio('00000000-0000-4000-8000-000000000099'))
    const view = renderPage(true, 'ADMIN')
    expect(await screen.findByRole('alert')).toHaveTextContent(/enlace no corresponde/i)
    expect(condonationMocks.listCondonationLifecycle).not.toHaveBeenCalled()
    view.unmount()

    navigationMocks.params = new URLSearchParams(handoffQuery())
    sociosMocks.getSocio.mockResolvedValue(handoffSocio())
    duesMocks.getDebt.mockResolvedValue(handoffDebt())
    condonationMocks.listCondonationLifecycle.mockResolvedValue({
      items: [
        { ...handoffLifecycle(), id: '00000000-0000-4000-8000-000000000099' },
        {
          ...handoffLifecycle(),
          snapshot: {
            ...handoffLifecycle().snapshot,
            member_id: '00000000-0000-4000-8000-000000000099',
          },
        },
      ],
    })
    renderPage(true, 'ADMIN')
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se encontró la solicitud/i)
    expect(condonationMocks.executeCondonationRequest).not.toHaveBeenCalled()
  })

  it('reports lookup and lifecycle failures truthfully', async () => {
    navigationMocks.params = new URLSearchParams(handoffQuery())
    sociosMocks.getSocio.mockRejectedValue(new Error('offline'))
    const view = renderPage(true, 'ADMIN')
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo cargar el socio/i)
    view.unmount()

    navigationMocks.params = new URLSearchParams(handoffQuery())
    sociosMocks.getSocio.mockResolvedValue(handoffSocio())
    duesMocks.getDebt.mockResolvedValue(handoffDebt())
    condonationMocks.listCondonationLifecycle.mockRejectedValue(new Error('offline'))
    renderPage(true, 'ADMIN')
    expect(
      await screen.findByRole('alert', { name: 'Acceso contextual de condonación' }),
    ).toHaveTextContent(/No se pudo cargar.*condonación indicada/i)
  })

  it('reports when the linked member detail cannot be loaded', async () => {
    navigationMocks.params = new URLSearchParams(handoffQuery())
    sociosMocks.getSocio.mockResolvedValue(handoffSocio())
    duesMocks.getDebt.mockRejectedValue(new Error('offline'))
    renderPage(true, 'ADMIN')
    expect(
      await screen.findByRole('alert', { name: 'Acceso contextual de condonación' }),
    ).toHaveTextContent(/No se pudo cargar el detalle del socio/i)
    expect(condonationMocks.executeCondonationRequest).not.toHaveBeenCalled()
  })

  it('lets a newer manual selection win over a late handoff lookup', async () => {
    let resolve!: (value: ReturnType<typeof handoffSocio>) => void
    sociosMocks.getSocio.mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const beto = { id: 'socio-2', nombre: 'Beto', apellido: 'López', numero_socio: '43' }
    sociosMocks.getSocios.mockResolvedValue({ items: [beto] })
    duesMocks.getDebt.mockResolvedValue(handoffDebt(beto.id))
    navigationMocks.params = new URLSearchParams(handoffQuery())
    const user = userEvent.setup()
    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Beto')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /López, Beto/ }))
    await act(async () => resolve(handoffSocio()))
    expect(duesMocks.getDebt).toHaveBeenCalledWith(beto.id)
    expect(duesMocks.getDebt).not.toHaveBeenCalledWith(handoff.memberId)
    expect(screen.queryByRole('button', { name: /ejecutar condonación/i })).not.toBeInTheDocument()
  })

  it('opens on Cobranza and keeps pricing configuration in a dialog', async () => {
    const user = userEvent.setup()
    renderPage(true, 'ADMIN')

    expect(screen.getByRole('tab', { name: 'Cobranza' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Detalle de deuda' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vista previa de evaluación' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Generación de deudas' }))
    expect(screen.getByRole('heading', { name: 'Generación mensual' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Detalle de deuda' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Cobranza' }))
    expect(screen.getByRole('heading', { name: 'Detalle de deuda' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vista previa de evaluación' })).toBeInTheDocument()

    const pricingTrigger = screen.getByRole('button', { name: 'Configurar cuotas' })
    await user.click(pricingTrigger)
    const pricingDialog = screen.getByRole('dialog', { name: 'Configuración de cuotas' })
    expect(pricingDialog).toBeInTheDocument()
    expect(
      within(pricingDialog).getAllByRole('heading', { name: 'Configuración de cuotas' }),
    ).toHaveLength(1)
    expect(
      within(pricingDialog).getByRole('heading', { name: 'Cuota base y adicionales' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Tipo de cuota')).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pricingTrigger).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Cobranza' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps only the latest member search response when requests finish out of order', async () => {
    let resolveOlder!: (value: {
      items: { id: string; nombre: string; apellido: string; numero_socio: string }[]
    }) => void
    let resolveNewer!: (value: {
      items: { id: string; nombre: string; apellido: string; numero_socio: string }[]
    }) => void
    const older = new Promise<{
      items: { id: string; nombre: string; apellido: string; numero_socio: string }[]
    }>((resolve) => {
      resolveOlder = resolve
    })
    const newer = new Promise<{
      items: { id: string; nombre: string; apellido: string; numero_socio: string }[]
    }>((resolve) => {
      resolveNewer = resolve
    })
    sociosMocks.getSocios.mockReturnValueOnce(older).mockReturnValueOnce(newer)
    renderPage(true, 'ADMIN')

    const search = screen.getByRole('search')
    const input = screen.getByLabelText('Buscar socio')
    await userEvent.setup().type(input, 'Ana')
    fireEvent.submit(search)
    await userEvent.setup().clear(input)
    await userEvent.setup().type(input, 'Beto')
    fireEvent.submit(search)

    resolveNewer({
      items: [{ id: 'socio-2', nombre: 'Beto', apellido: 'López', numero_socio: '43' }],
    })
    expect(await screen.findByRole('button', { name: /lópez, beto/i })).toBeInTheDocument()
    await act(async () => {
      resolveOlder({
        items: [{ id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }],
      })
    })

    expect(screen.queryByRole('button', { name: /gorriti, ana/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /lópez, beto/i })).toBeInTheDocument()
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

  it('exposes labelled landmarks for an authorized operator', () => {
    renderPage(true, 'TESORERO')
    expect(screen.getByRole('main', { name: /cobranza/i })).toHaveClass(
      'min-w-0',
      'bg-surface-page',
    )
    expect(screen.getByRole('heading', { name: /^cobranza$/i })).toHaveClass('font-display')
    expect(screen.getByRole('tablist', { name: /secciones de cobranza/i })).toBeInTheDocument()
  })

  it('shows generation to TESORERO but keeps it and pricing hidden from OPERADOR', async () => {
    const user = userEvent.setup()
    const treasurer = renderPage(true, 'TESORERO')
    await user.click(screen.getByRole('tab', { name: 'Generación de deudas' }))
    expect(screen.getByRole('heading', { name: 'Generación mensual' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configurar cuotas' })).not.toBeInTheDocument()

    treasurer.unmount()
    renderPage(true, 'OPERADOR')
    expect(screen.getByRole('heading', { name: 'Detalle de deuda' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Generación de deudas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configurar cuotas' })).not.toBeInTheDocument()
  })
})

describe('assessment price-gap recovery', () => {
  const socio = {
    id: 'socio-natacion',
    nombre: 'Ana',
    apellido: 'Gorriti',
    numero_socio: '42',
    fecha_alta: '2026-01-15',
  }
  const blockedPreview = {
    socio_id: socio.id,
    from_period: '2026-07',
    through_period: '2026-09',
    executable: false,
    currency: 'ARS',
    fingerprint: 'blocked-preview',
    issues: [
      {
        code: 'PRICE_GAP' as const,
        componentKey: 'sport:enrollment-natacion',
        from: '2026-07-25',
        to: '2026-08-01',
        period: '2026-07',
      },
      {
        code: 'PRICE_GAP' as const,
        componentKey: 'sport:enrollment-natacion',
        from: '2026-08-01',
        to: '2026-08-24',
        period: '2026-08',
      },
    ],
    periods: [
      {
        period: '2026-07',
        start: '2026-07-01',
        end: '2026-08-01',
        calendarDays: 31,
        existingObligationId: null,
        pendingAmountCents: null,
        components: [
          {
            componentKey: 'sport:enrollment-natacion',
            kind: 'SPORT' as const,
            disciplinaId: 'disciplina-natacion',
            eligibleFrom: '2026-07-25',
            eligibleTo: '2026-08-01',
            eligibleDays: 7,
            calendarDays: 31,
            segments: [],
            numerator: 0,
            remainder: 0,
            amountCents: 0,
            status: 'CONFLICT' as const,
          },
        ],
      },
    ],
  }
  const successfulPreview = {
    ...blockedPreview,
    executable: true,
    issues: [],
    periods: blockedPreview.periods.map((period) => ({
      ...period,
      pendingAmountCents: 100,
      components: period.components.map((component) => ({
        ...component,
        status: 'PENDING' as const,
        amountCents: 100,
      })),
    })),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sociosMocks.getSocios.mockResolvedValue({ items: [socio] })
    duesMocks.getDebt.mockResolvedValue({
      status: 'ready',
      socio_id: socio.id,
      currency: 'ARS',
      total_debt_cents: 0,
      obligations: [],
    })
    duesMocks.getDuesPrices.mockResolvedValue({ items: [] })
    padronesMocks.getDisciplinas.mockResolvedValue({
      items: [{ id: 'disciplina-natacion', codigo: 'NATACION', nombre: 'Natación' }],
    })
    treasuryMocks.getOpenCashShifts.mockResolvedValue([])
    condonationMocks.listCondonationLifecycle.mockResolvedValue({ items: [] })
  })

  it('repairs a blocked SPORT range, generates it, and records its full payment through mocked boundaries', async () => {
    const user = userEvent.setup()
    const generatedDebt = {
      status: 'ready' as const,
      socio_id: socio.id,
      currency: 'ARS',
      total_debt_cents: 100,
      obligations: [
        {
          id: 'gap-obligation-1',
          period_start: '2026-07-01',
          period_end: '2026-08-01',
          original_amount_cents: 100,
          outstanding_cents: 100,
          currency: 'ARS',
          status: 'OPEN' as const,
          components: [],
          benefits: [],
          allocations: [],
        },
      ],
    }
    const paidDebt = {
      ...generatedDebt,
      total_debt_cents: 0,
      obligations: generatedDebt.obligations.map((obligation) => ({
        ...obligation,
        outstanding_cents: 0,
        status: 'PAID' as const,
      })),
    }
    duesMocks.getDebt
      .mockReset()
      .mockResolvedValueOnce({
        status: 'ready',
        socio_id: socio.id,
        currency: 'ARS',
        total_debt_cents: 0,
        obligations: [],
      })
      .mockResolvedValueOnce(generatedDebt)
      .mockResolvedValueOnce(paidDebt)
    treasuryMocks.getOpenCashShifts.mockResolvedValue([
      {
        id: 'shift-gap-1',
        desk_id: 'desk-1',
        status: 'OPEN',
        business_date: '2026-07-25',
        assigned_operator_id: 'operator-1',
        opened_at: new Date().toISOString(),
        closed_at: null,
      },
    ])
    duesMocks.previewDuesAssessments
      .mockResolvedValueOnce(blockedPreview)
      .mockResolvedValueOnce(successfulPreview)
      .mockResolvedValueOnce(successfulPreview)
    duesMocks.createDuesPrice.mockResolvedValue({ id: 'sport-price-1' })
    duesMocks.executeDuesAssessmentRange.mockResolvedValue({
      created_obligation_ids: ['gap-obligation-1'],
    })
    duesMocks.createFullSelectionPayment.mockResolvedValue({
      settlement_id: 'gap-settlement-1',
      amount_cents: 100,
      currency: 'ARS',
      allocations: [],
    })

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.click(screen.getByRole('button', { name: 'Elegir rango para evaluar' }))
    await user.clear(screen.getByLabelText('Desde'))
    await user.type(screen.getByLabelText('Desde'), '2026-07')
    await user.clear(screen.getByLabelText('Hasta'))
    await user.type(screen.getByLabelText('Hasta'), '2026-09')
    await user.click(screen.getByRole('button', { name: 'Consultar vista previa' }))
    await screen.findByRole('alert')

    await user.click(
      within(screen.getByRole('region', { name: 'Vista previa de evaluación' })).getByRole(
        'button',
        { name: 'Configurar cuotas' },
      ),
    )
    expect(screen.getByLabelText('Tipo de cuota')).toHaveValue('SPORT')
    expect(screen.getByLabelText('Disciplina')).toHaveValue('disciplina-natacion')
    expect(screen.getByLabelText('Vigente desde')).toHaveValue('25/07/2026')
    expect(screen.getByLabelText('Vigente hasta')).toHaveValue('24/08/2026')
    expect(screen.getByLabelText('Importe mensual (ARS)')).toHaveValue('')

    await user.type(screen.getByLabelText('Importe mensual (ARS)'), '1')
    await user.click(screen.getByRole('button', { name: 'Guardar cuota' }))

    await waitFor(() =>
      expect(duesMocks.createDuesPrice).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'SPORT',
          disciplina_id: 'disciplina-natacion',
          amount_cents: 100,
          effective_from: '2026-07-25',
          effective_to: '2026-08-24',
        }),
      ),
    )
    expect(duesMocks.createDuesPrice).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'BASE' }),
    )
    await waitFor(() =>
      expect(duesMocks.previewDuesAssessments).toHaveBeenLastCalledWith({
        socio_id: socio.id,
        from_period: '2026-07',
        through_period: '2026-09',
      }),
    )

    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('dialog', { name: 'Configuración de cuotas' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generar obligaciones del rango' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar generación con esta huella' }))
    await waitFor(() =>
      expect(duesMocks.executeDuesAssessmentRange).toHaveBeenCalledWith(
        {
          socio_id: socio.id,
          from_period: '2026-07',
          through_period: '2026-09',
          preview_fingerprint: successfulPreview.fingerprint,
        },
        expect.any(String),
      ),
    )
    const summary = await screen.findByLabelText(/resumen de deuda de gorriti, ana/i)
    expect(summary).toHaveFocus()
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    expect(duesMocks.previewDuesAssessments).toHaveBeenLastCalledWith({
      socio_id: socio.id,
      from_period: '2026-07',
      through_period: '2026-09',
    })
    expect(screen.getByText('Deuda total pendiente: $ 1,00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }))
    await waitFor(() =>
      expect(duesMocks.createFullSelectionPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          socio_id: socio.id,
          obligation_ids: ['gap-obligation-1'],
          shift_id: 'shift-gap-1',
          tender: 'CASH',
        }),
        expect.any(String),
      ),
    )
    expect(await screen.findByText('Pago registrado.')).toBeInTheDocument()
    expect(screen.getByText('Deuda total pendiente: $ 0,00')).toBeInTheDocument()
  })

  it('keeps the newest range preview and does not focus debt after an older generation refresh completes', async () => {
    const user = userEvent.setup()
    let resolveGenerated!: (value: typeof blockedPreview | typeof successfulPreview) => void
    let resolveNewest!: (value: typeof successfulPreview) => void
    const generated = new Promise<typeof blockedPreview | typeof successfulPreview>((resolve) => {
      resolveGenerated = resolve
    })
    const newest = new Promise<typeof successfulPreview>((resolve) => {
      resolveNewest = resolve
    })
    duesMocks.previewDuesAssessments
      .mockResolvedValueOnce(successfulPreview)
      .mockReturnValueOnce(generated)
      .mockReturnValueOnce(newest)
    duesMocks.executeDuesAssessmentRange.mockResolvedValue({ created_obligation_ids: [] })

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.click(screen.getByRole('button', { name: 'Elegir rango para evaluar' }))
    await user.clear(screen.getByLabelText('Desde'))
    await user.type(screen.getByLabelText('Desde'), '2026-07')
    await user.clear(screen.getByLabelText('Hasta'))
    await user.type(screen.getByLabelText('Hasta'), '2026-09')
    await user.click(screen.getByRole('button', { name: 'Consultar vista previa' }))
    await user.click(await screen.findByRole('button', { name: 'Generar obligaciones del rango' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar generación con esta huella' }))
    await waitFor(() => expect(duesMocks.previewDuesAssessments).toHaveBeenCalledTimes(2))

    await user.clear(screen.getByLabelText('Desde'))
    await user.type(screen.getByLabelText('Desde'), '2026-08')
    await user.clear(screen.getByLabelText('Hasta'))
    await user.type(screen.getByLabelText('Hasta'), '2026-09')
    fireEvent.submit(screen.getByLabelText('Desde').closest('form')!)
    await waitFor(() => expect(duesMocks.previewDuesAssessments).toHaveBeenCalledTimes(3))
    await act(async () => {
      resolveNewest({
        ...successfulPreview,
        from_period: '2026-08',
        through_period: '2026-09',
        fingerprint: 'newest-preview',
      })
    })
    await screen.findByText('newest-preview')

    await act(async () => {
      resolveGenerated(blockedPreview)
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('newest-preview')).toBeInTheDocument()
    expect(screen.getByLabelText(/resumen de deuda de gorriti, ana/i)).not.toHaveFocus()
  })

  it('ignores an older preview rejection after a newer range succeeds', async () => {
    const user = userEvent.setup()
    let rejectOlder!: (reason?: unknown) => void
    let resolveNewer!: (value: typeof successfulPreview) => void
    const older = new Promise<typeof successfulPreview>((_resolve, reject) => {
      rejectOlder = reject
    })
    const newer = new Promise<typeof successfulPreview>((resolve) => {
      resolveNewer = resolve
    })
    duesMocks.previewDuesAssessments.mockReturnValueOnce(older).mockReturnValueOnce(newer)

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.click(screen.getByRole('button', { name: 'Elegir rango para evaluar' }))
    await user.click(screen.getByRole('button', { name: 'Consultar vista previa' }))
    await user.clear(screen.getByLabelText('Desde'))
    await user.type(screen.getByLabelText('Desde'), '2026-08')
    fireEvent.submit(screen.getByLabelText('Desde').closest('form')!)
    await waitFor(() => expect(duesMocks.previewDuesAssessments).toHaveBeenCalledTimes(2))
    await act(async () => {
      resolveNewer({ ...successfulPreview, from_period: '2026-08', fingerprint: 'newest-preview' })
    })
    await screen.findByRole('button', { name: 'Generar obligaciones del rango' })

    await act(async () => {
      rejectOlder(new Error('stale offline'))
    })

    expect(screen.queryByText('No se pudo consultar la evaluación.')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generar obligaciones del rango' }),
    ).toBeInTheDocument()
  })

  it('ignores a stale preview completion after switching members', async () => {
    const user = userEvent.setup()
    const beto = {
      ...socio,
      id: 'socio-beto',
      nombre: 'Beto',
      apellido: 'López',
      numero_socio: '43',
    }
    let resolveOlder!: (value: typeof blockedPreview) => void
    const older = new Promise<typeof blockedPreview>((resolve) => {
      resolveOlder = resolve
    })
    sociosMocks.getSocios.mockResolvedValue({ items: [socio, beto] })
    duesMocks.previewDuesAssessments.mockReturnValueOnce(older)

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))
    await user.click(screen.getByRole('button', { name: 'Elegir rango para evaluar' }))
    await user.click(screen.getByRole('button', { name: 'Consultar vista previa' }))
    await user.click(screen.getByRole('button', { name: /López, Beto/ }))
    await act(async () => {
      resolveOlder(blockedPreview)
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Generar obligaciones del rango' }),
    ).not.toBeInTheDocument()
  })

  it('labels an empty debt response as not yet recorded instead of as zero debt', async () => {
    const user = userEvent.setup()
    duesMocks.getDebt.mockResolvedValue({
      status: 'empty',
      socio_id: socio.id,
      currency: 'ARS',
      total_debt_cents: 0,
      obligations: [],
    })

    renderPage(true, 'ADMIN')
    await user.type(screen.getByLabelText('Buscar socio'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Buscar socio' }))
    await user.click(await screen.findByRole('button', { name: /Gorriti, Ana/ }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Todavía no se generaron obligaciones para este socio. Consultá la vista previa del período para generarlas.',
    )
    expect(screen.queryByText(/Deuda total pendiente:/)).not.toBeInTheDocument()
  })
})

describe('payment orchestration and recovery', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })
  const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
  const shift = {
    id: 'shift-1',
    desk_id: 'desk-1',
    status: 'OPEN' as const,
    business_date: '2026-01-15',
    assigned_operator_id: 'operator-1',
    opened_at: new Date().toISOString(),
    closed_at: null,
  }
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
    duesMocks.createFullSelectionPayment.mockResolvedValue({
      settlement_id: 'settlement-1',
      amount_cents: 10_000,
      currency: 'ARS',
      allocations: [],
    })
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

  it('keeps the server-confirmed outcome after the paid debt removes payment actions', async () => {
    prepare()
    duesMocks.getDebt
      .mockReset()
      .mockResolvedValueOnce(debt)
      .mockResolvedValueOnce({
        ...debt,
        status: 'empty',
        total_debt_cents: 0,
        obligations: [],
      })
    duesMocks.createFullSelectionPayment.mockResolvedValue({
      settlement_id: 'settlement-1',
      amount_cents: 10_000,
      currency: 'ARS',
      allocations: [],
    })
    const user = await openPayment()
    await user.click(screen.getByLabelText('Transferencia'))
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }))

    const result = await screen.findByRole('region', { name: 'Resultado del pago' })
    expect(within(result).getByRole('heading', { name: 'Pago registrado' })).toBeInTheDocument()
    expect(within(result).getByText(/\$\s*100,00/)).toBeInTheDocument()
    expect(result).toHaveTextContent('settlement-1')
    expect(result).toHaveTextContent('TRANSFER')
    expect(within(result).getByRole('button', { name: 'Ver e imprimir constancia' })).toBeEnabled()
    expect(
      screen.queryByRole('dialog', { name: 'Constancia de pago no fiscal' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(result).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument()
  })

  it('waits for an alertdialog to close before focusing the confirmed result', async () => {
    prepare()
    duesMocks.createFullSelectionPayment.mockResolvedValue({
      settlement_id: 'settlement-1',
      amount_cents: 10_000,
      currency: 'ARS',
      allocations: [],
    })
    const user = await openPayment()
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const alert = document.createElement('div')
    alert.setAttribute('role', 'alertdialog')
    alert.setAttribute('aria-modal', 'true')
    document.body.appendChild(alert)
    try {
      await user.click(screen.getByRole('button', { name: 'Confirmar pago' }))
      const result = await screen.findByRole('region', { name: 'Resultado del pago' })
      act(() => {
        frames.splice(0).forEach((callback) => callback(0))
      })
      expect(result).not.toHaveFocus()
      await act(async () => {
        alert.remove()
      })
      act(() => {
        frames.splice(0).forEach((callback) => callback(0))
      })
      expect(result).toHaveFocus()
    } finally {
      alert.remove()
      raf.mockRestore()
    }
  })

  it('does not refocus the confirmed result or submit again after balance recovery', async () => {
    prepare()
    duesMocks.getDebt
      .mockReset()
      .mockResolvedValueOnce(debt)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...debt, total_debt_cents: 0, obligations: [] })
    duesMocks.createFullSelectionPayment.mockResolvedValue({
      settlement_id: 'settlement-1',
      amount_cents: 10_000,
      currency: 'ARS',
      allocations: [],
    })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const user = await openPayment()
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }))
    const result = await screen.findByRole('region', { name: 'Resultado del pago' })
    await waitFor(() => expect(result).toHaveFocus())
    const resultFocuses = () => focus.mock.contexts.filter((element) => element === result)
    expect(resultFocuses()).toHaveLength(1)
    await user.click(within(result).getByRole('button', { name: 'Actualizar saldo' }))
    await waitFor(() => expect(within(result).queryByRole('alert')).not.toBeInTheDocument())
    expect(resultFocuses()).toHaveLength(1)
    expect(duesMocks.createFullSelectionPayment).toHaveBeenCalledTimes(1)
    focus.mockRestore()
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
  const completeDraft = async (user: ReturnType<typeof userEvent.setup>) => { await user.type(screen.getByLabelText(/valor aprobado/i), '25'); await user.type(screen.getByLabelText('Evidencia del trabajo aceptado'), 'Acta 12 aprobada'); await user.type(screen.getByLabelText('Motivo de la aceptación'), 'Trabajo aceptado'); await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i })) }

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

  it('keeps a member-scoped community-work confirmation after its full settlement closes the obligation', async () => {
    prepare()
    duesMocks.getDebt.mockReset().mockResolvedValueOnce(debt(2_500)).mockResolvedValueOnce(debt(0))
    duesMocks.createCommunityWorkEvidence.mockResolvedValue(communityResult())
    const user = await openForm()
    await completeDraft(user)

    expect(
      await screen.findByRole('region', { name: 'Resultado del trabajo comunitario' }),
    ).toHaveTextContent(
      'Trabajo comunitario registrado para la obligación obligation-1 por $ 25,00. Operación work-1.',
    )
    expect(
      screen.queryByRole('button', { name: /registrar trabajo comunitario/i }),
    ).not.toBeInTheDocument()
  })

  it('does not show an older member’s confirmed work after switching members during the POST', async () => {
    const ana = socio
    const beto = { id: 'socio-2', nombre: 'Beto', apellido: 'López', numero_socio: '43' }
    let resolvePost!: (result: ReturnType<typeof communityResult>) => void
    duesMocks.getDebt.mockReset().mockResolvedValue(debt())
    duesMocks.getObligationAgreements.mockResolvedValue({ active, revisions: [active] })
    sociosMocks.getSocios.mockResolvedValue({ items: [ana, beto] })
    duesMocks.createCommunityWorkEvidence.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve
      }),
    )
    const user = await openForm()
    await completeDraft(user)
    await user.click(screen.getByRole('button', { name: /López, Beto/ }))
    resolvePost(communityResult())

    await waitFor(() => expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalled())
    expect(
      screen.queryByRole('region', { name: 'Resultado del trabajo comunitario' }),
    ).not.toBeInTheDocument()
  })

  it('records POST success before a failed debt refresh and retries only the refresh', async () => {
    prepare()
    duesMocks.getDebt
      .mockReset()
      .mockResolvedValueOnce(debt())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(debt(7_500))
    duesMocks.createCommunityWorkEvidence.mockResolvedValue(communityResult())
    const user = await openForm()
    await completeDraft(user)

    expect(
      await screen.findByText(
        'Trabajo comunitario registrado para la obligación obligation-1 por $ 25,00. Operación work-1. No se pudo actualizar el saldo.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: 'Registrar trabajo comunitario' }),
    ).not.toBeInTheDocument()
    expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Actualizar saldo' }))
    await waitFor(() => expect(duesMocks.getDebt).toHaveBeenCalledTimes(3))
    expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('region', { name: 'Resultado del trabajo comunitario' }),
    ).toHaveTextContent('Trabajo comunitario registrado')
  })

  it('keeps a 409 draft in its open dialog while retrying only GET balance recovery', async () => {
    prepare()
    duesMocks.getDebt
      .mockReset()
      .mockResolvedValueOnce(debt())
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValue(debt())
    duesMocks.createCommunityWorkEvidence
      .mockRejectedValueOnce(new duesMocks.DuesOperationError('conflict', 'conflict'))
      .mockResolvedValueOnce(communityResult())
    const user = await openForm()
    await completeDraft(user)

    const dialog = await screen.findByRole('dialog', { name: 'Registrar trabajo comunitario' })
    expect(within(dialog).getByRole('button', { name: 'Actualizar saldo' })).toBeEnabled()
    expect(within(dialog).getByLabelText('Valor aprobado (ARS)')).toHaveValue('25,00')
    expect(within(dialog).getByLabelText('Evidencia del trabajo aceptado')).toHaveValue(
      'Acta 12 aprobada',
    )
    expect(within(dialog).getByLabelText('Motivo de la aceptación')).toHaveValue('Trabajo aceptado')
    expect(
      within(dialog).getByRole('button', { name: /confirmar trabajo comunitario/i }),
    ).toBeDisabled()
    expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(1)
    const conflictKey = duesMocks.createCommunityWorkEvidence.mock.calls[0]![1]

    await user.click(within(dialog).getByRole('button', { name: 'Actualizar saldo' }))
    await waitFor(() => expect(duesMocks.getDebt).toHaveBeenCalledTimes(3))
    expect(within(dialog).getByRole('button', { name: 'Actualizar saldo' })).toBeEnabled()
    expect(
      within(dialog).getByRole('button', { name: /confirmar trabajo comunitario/i }),
    ).toBeDisabled()
    expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(1)

    await user.click(within(dialog).getByRole('button', { name: 'Actualizar saldo' }))
    await waitFor(() => expect(duesMocks.getDebt).toHaveBeenCalledTimes(4))
    expect(
      within(dialog).getByRole('button', { name: /confirmar trabajo comunitario/i }),
    ).toBeEnabled()
    expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(1)

    await user.click(within(dialog).getByRole('button', { name: /confirmar trabajo comunitario/i }))
    await waitFor(() => expect(duesMocks.createCommunityWorkEvidence).toHaveBeenCalledTimes(2))
    expect(duesMocks.createCommunityWorkEvidence.mock.calls[1]![1]).not.toBe(conflictKey)
  })

  it('uses the server replay result after an unknown POST failure preserves the key', async () => {
    prepare()
    duesMocks.createCommunityWorkEvidence
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(communityResult(false))
    const user = await openForm()
    await completeDraft(user)

    await waitFor(() =>
      expect(screen.getByText(/no se pudo registrar el trabajo/i)).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: /confirmar trabajo comunitario/i }))

    expect(
      await screen.findByText(/trabajo comunitario registrado para la obligación/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/ya había sido registrado/i)).not.toBeInTheDocument()
  })

  it.each([
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
    expect(duesMocks.getDebt).toHaveBeenCalledTimes(3)
  })
})
