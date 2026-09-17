import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { COLLECTIONS_IDEMPOTENCY_STORAGE_KEY } from '@/lib/collections-idempotency'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as CondonationApi from '@/lib/api/condonation'
import type * as CommunityWorkApi from '@/lib/api/community-work-approval'
type CondonationQueueItem = CondonationApi.CondonationQueueItem
type CondonationQueuePage = CondonationApi.CondonationQueuePage

const pushMock = vi.fn()
const useAuthMock = vi.fn()
const listQueueMock = vi.fn()
const decideMock = vi.fn()
const executeMock = vi.fn()
const listLifecycleMock = vi.fn()
const getApprovalMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => useAuthMock() }))
vi.mock('@/lib/api/approvals', () => ({ getApproval: getApprovalMock }))
vi.mock('@/lib/api/condonation', async (importOriginal) => {
  const actual = await importOriginal<typeof CondonationApi>()
  return {
    ...actual,
    listCondonationQueue: (...args: unknown[]) => listQueueMock(...args),
    decideCondonationRequest: (...args: unknown[]) => decideMock(...args),
    executeCondonationRequest: executeMock,
    listCondonationLifecycle: (...args: unknown[]) => listLifecycleMock(...args),
  }
})
const communityQueueMock = vi.fn()
const communityDecideMock = vi.fn()
const communityExecuteMock = vi.fn()
const communityLifecycleMock = vi.fn()
vi.mock('@/lib/api/community-work-approval', async (importOriginal) => {
  const actual = await importOriginal<typeof CommunityWorkApi>()
  return {
    ...actual,
    listCommunityWorkQueue: (...args: unknown[]) => communityQueueMock(...args),
    decideCommunityWorkRequest: (...args: unknown[]) => communityDecideMock(...args),
    executeCommunityWorkRequest: communityExecuteMock,
    listCommunityWorkLifecycle: (...args: unknown[]) => communityLifecycleMock(...args),
  }
})
const { CondonationOperationError } = await import('@/lib/api/condonation')
const { CommunityWorkOperationError } = await import('@/lib/api/community-work-approval')
const { CondonationDecisionDialog } =
  await import('@/components/collections/CondonationDecisionDialog')
const { default: ApprovalsListPage } = await import('./page')

type Role = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
const auth = (role: Role = 'ADMIN', operatorId = 'operator-1') => ({
  user: { operator_id: operatorId, role, username: 'usuario' },
})
const item = (name = 'Ana', suffix = '1'): CondonationQueueItem => ({
  id: `00000000-0000-4000-8000-00000000000${suffix}`,
  state: 'pending',
  expires_at: '2030-01-01T12:00:00.000Z',
  decided_at: null,
  execution_id: null,
  execution_status: 'unavailable',
  created_at: '2026-09-01T12:00:00.000Z',
  snapshot: {
    member_id: '00000000-0000-4000-8000-000000000042',
    obligations: [
      {
        obligation_id: '00000000-0000-4000-8000-000000000050',
        currency: 'ARS',
        outstanding_amount_cents: 12500,
      },
    ],
  },
  current_member: {
    id: '00000000-0000-4000-8000-000000000042',
    numero_socio: '0042',
    nombre: name,
    apellido: 'Pérez',
  },
  requester: { id: '00000000-0000-4000-8000-000000000060', username: 'solicitante' },
  context: 'Regularización de cuota social',
  reason: 'Situación económica comprobada',
  evidence: 'Informe social adjunto',
})
const page = (
  items: CondonationQueueItem[] = [],
  next_cursor: string | null = null,
): CondonationQueuePage => ({ items, next_cursor })
function deferred() {
  let resolve!: (value: CondonationQueuePage) => void
  const promise = new Promise<CondonationQueuePage>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const clients: QueryClient[] = []
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  const view = render(<ApprovalsListPage />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { ...view, client }
}
const member = (name: string) => screen.findByRole('heading', { name: new RegExp(`${name} Pérez`) })
const noMember = (name: string) =>
  expect(
    screen.queryByRole('heading', { name: new RegExp(`${name} Pérez`) }),
  ).not.toBeInTheDocument()

describe('Approvals queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue(auth())
    listQueueMock.mockReset().mockResolvedValue(page())
    communityQueueMock.mockReset().mockResolvedValue({ items: [], next_cursor: null })
    decideMock.mockReset()
    executeMock.mockReset()
    listLifecycleMock.mockReset().mockImplementation(() => {
      const executionId =
        executeMock.mock.calls.at(-1)?.[1] ?? '00000000-0000-4000-8000-000000000070'
      return Promise.resolve({
        items: [
          {
            ...item(),
            state: executeMock.mock.calls.length ? 'executed' : 'approved_awaiting_execution',
            decided_at: '2026-09-09T12:00:00.000Z',
            execution_id: executionId,
            execution_status: executeMock.mock.calls.length ? 'executed' : 'recoverable',
          },
        ],
      })
    })
    window.sessionStorage.removeItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY)
  })
  afterEach(() => {
    clients.splice(0).forEach((client) => client.clear())
  })

  it.each(['ADMIN', 'TESORERO'] as const)(
    'shows authoritative context and no financial controls to %s',
    async (role) => {
      useAuthMock.mockReturnValue(auth(role))
      listQueueMock.mockResolvedValue(page([item()]))
      renderPage()
      await member('Ana')
      expect(listQueueMock).toHaveBeenCalledWith({ view: 'all' })
      expect(screen.getByText(/0042/)).toBeInTheDocument()
      expect(screen.getByText(/Datos actuales del socio/)).toBeInTheDocument()
      for (const text of [
        'solicitante',
        item().context,
        item().reason,
        item().evidence,
        'Pendiente',
      ])
        expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.getByText(/125,00/)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /ejecutar|registrar decisión|enviar solicitud/i }),
      ).not.toBeInTheDocument()
      expect(Boolean(screen.queryByTestId('approvals-deeplink'))).toBe(role === 'ADMIN')
      expect(getApprovalMock).not.toHaveBeenCalled()
    },
  )

  it.each(['OPERADOR', 'CONSULTA'] as const)('denies %s before requesting the queue', (role) => {
    useAuthMock.mockReturnValue(auth(role))
    renderPage()
    expect(screen.getByText('Sin permisos')).toBeInTheDocument()
    expect(listQueueMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('approvals-deeplink')).not.toBeInTheDocument()
  })

  it('does not request data before the authenticated identity is available', () => {
    useAuthMock.mockReturnValue({ user: null })
    renderPage()
    expect(listQueueMock).not.toHaveBeenCalled()
    expect(screen.getByText('Sin permisos')).toBeInTheDocument()
  })

  it('shows loading followed by an explicit empty result', async () => {
    const pending = deferred()
    listQueueMock.mockReturnValueOnce(pending.promise)
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Cargando condonaciones')
    expect(screen.queryByText(/No hay condonaciones/)).not.toBeInTheDocument()
    await act(async () => pending.resolve(page()))
    expect(await screen.findByText(/No hay condonaciones para revisar/)).toBeInTheDocument()
  })

  it.each([
    ['permission', /No tenés permisos/],
    ['partial_data', /datos incompletos/],
    ['unavailable', /No se pudo cargar/],
  ] as const)('reports %s and retries the failed first page', async (kind, copy) => {
    listQueueMock.mockRejectedValueOnce(new CondonationOperationError(kind))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(copy)
    listQueueMock.mockResolvedValueOnce(page([item()]))
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    await member('Ana')
    expect(listQueueMock).toHaveBeenCalledTimes(2)
  })

  it('appends only requested opaque pages, deduplicates identities and stops at the end', async () => {
    listQueueMock
      .mockResolvedValueOnce(page([item()], 'opaque_cursor'))
      .mockResolvedValueOnce(page([item(), item('Beto', '2')]))
    const user = userEvent.setup()
    renderPage()
    await member('Ana')
    expect(listQueueMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Cargar más' }))
    await member('Beto')
    expect(screen.getAllByRole('heading', { name: /Ana Pérez/ })).toHaveLength(1)
    expect(listQueueMock).toHaveBeenLastCalledWith({ view: 'all', cursor: 'opaque_cursor' })
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
  })

  it('keeps rows after a next-page failure and retries that same cursor', async () => {
    listQueueMock
      .mockResolvedValueOnce(page([item()], 'opaque_cursor'))
      .mockRejectedValueOnce(new CondonationOperationError('unavailable'))
      .mockResolvedValueOnce(page([item('Beto', '2')]))
    const user = userEvent.setup()
    renderPage()
    await member('Ana')
    await user.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo cargar/)
    await member('Ana')
    await user.click(screen.getByRole('button', { name: 'Reintentar cargar más' }))
    await member('Beto')
    expect(listQueueMock.mock.calls.slice(1)).toEqual([
      [{ view: 'all', cursor: 'opaque_cursor' }],
      [{ view: 'all', cursor: 'opaque_cursor' }],
    ])
  })

  it.each([
    ['ADMIN', 'operator-2'],
    ['TESORERO', 'operator-1'],
  ] as const)('isolates cached rows when identity changes to %s %s', async (role, operatorId) => {
    listQueueMock.mockResolvedValueOnce(page([item()]))
    const view = renderPage()
    await member('Ana')
    const pending = deferred()
    listQueueMock.mockReturnValueOnce(pending.promise)
    useAuthMock.mockReturnValue(auth(role, operatorId))
    view.rerender(<ApprovalsListPage />)
    noMember('Ana')
    await act(async () => pending.resolve(page([item('Beto', '2')])))
    await member('Beto')
    noMember('Ana')
    expect(listQueueMock).toHaveBeenCalledTimes(2)
    useAuthMock.mockReturnValue(auth('OPERADOR', operatorId))
    view.rerender(<ApprovalsListPage />)
    noMember('Beto')
    expect(listQueueMock).toHaveBeenCalledTimes(2)
  })

  it('ignores the previous actor first-page response after switching', async () => {
    const pending = deferred()
    listQueueMock
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([item('Beto', '2')]))
    const view = renderPage()
    useAuthMock.mockReturnValue(auth('TESORERO', 'operator-2'))
    view.rerender(<ApprovalsListPage />)
    await member('Beto')
    await act(async () => pending.resolve(page([item()])))
    noMember('Ana')
  })

  it('ignores an old actor next-page response and prevents overlapping pagination/refresh', async () => {
    const pending = deferred()
    listQueueMock
      .mockResolvedValueOnce(page([item()], 'opaque_cursor'))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([item('Beto', '2')]))
    const user = userEvent.setup()
    const view = renderPage()
    await member('Ana')
    await user.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(screen.getByRole('button', { name: 'Cargando más…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled()
    useAuthMock.mockReturnValue(auth('TESORERO', 'operator-2'))
    view.rerender(<ApprovalsListPage />)
    await member('Beto')
    await act(async () => pending.resolve(page([item('Carlos', '3')])))
    noMember('Ana')
    noMember('Carlos')
  })

  it('hides previously loaded rows when the server denies a subsequent page', async () => {
    listQueueMock
      .mockResolvedValueOnce(page([item()], 'opaque_cursor'))
      .mockRejectedValueOnce(new CondonationOperationError('permission'))
    const user = userEvent.setup()
    renderPage()
    await member('Ana')
    await user.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permisos')
    noMember('Ana')
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
  })

  it('clears the generic token input when another administrator becomes the current actor', async () => {
    const user = userEvent.setup()
    const view = renderPage()
    await screen.findByText(/No hay condonaciones/)
    await user.type(screen.getByRole('textbox', { name: 'Token de aprobación' }), 'private-token')
    useAuthMock.mockReturnValue(auth('ADMIN', 'operator-2'))
    view.rerender(<ApprovalsListPage />)
    expect(screen.getByRole('textbox', { name: 'Token de aprobación' })).toHaveValue('')
    await screen.findByText(/No hay condonaciones/)
    expect(listQueueMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes authoritative rows and exposes explicit recovery for an approved item', async () => {
    listQueueMock.mockResolvedValueOnce(page([item()])).mockResolvedValueOnce(
      page([
        {
          ...item('Beto', '2'),
          state: 'approved_awaiting_execution',
          execution_id: '00000000-0000-4000-8000-000000000070',
          execution_status: 'recoverable',
          decided_at: '2026-09-02T12:00:00.000Z',
        },
      ]),
    )
    const user = userEvent.setup()
    renderPage()
    await member('Ana')
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))
    await member('Beto')
    noMember('Ana')
    expect(screen.getByRole('button', { name: 'Aplicar condonación' })).toBeInTheDocument()
  })

  const recorded = (status: 'approved' | 'rejected' = 'approved') => ({
    id: item().id,
    status,
    expires_at: item().expires_at,
    decided_at: '2026-09-09T12:00:00.000Z',
  })
  async function fillDecision(user: ReturnType<typeof userEvent.setup>, decision = 'approved') {
    await member('Ana')
    await user.click(screen.getByRole('button', { name: 'Revisar solicitud' }))
    const dialog = screen.getByRole('dialog', { name: 'Decidir condonación' })
    await user.selectOptions(within(dialog).getByLabelText('Decisión'), decision)
    await user.type(within(dialog).getByLabelText('Motivo de la decisión'), '  Verificado  ')
    await user.type(within(dialog).getByLabelText('Evidencia de la decisión'), '  Acta 12  ')
    return dialog
  }

  it.each([
    ['ADMIN', 'approved'],
    ['TESORERO', 'rejected'],
  ] as const)(
    'records %s %s and retains confirmation after the row leaves the queue',
    async (role, decision) => {
      useAuthMock.mockReturnValue(auth(role))
      listQueueMock.mockResolvedValueOnce(page([item()]))
      decideMock.mockResolvedValueOnce(recorded(decision))
      const user = userEvent.setup()
      if (decision === 'approved')
        executeMock.mockImplementation((_requestId, executionId) =>
          Promise.resolve({
            execution_id: executionId,
            approval_id: item().id,
            member_id: item().snapshot.member_id,
            currency: 'ARS',
            approved_amount_cents: 12500,
            treatment_ids: ['00000000-0000-4000-8000-000000000071'],
            status: 'executed',
          }),
        )
      renderPage()
      const dialog = await fillDecision(user, decision)
      for (const text of [item().context, item().reason, item().evidence])
        expect(within(dialog).getByText(text)).toBeInTheDocument()
      await user.click(
        within(dialog).getByRole('button', {
          name: decision === 'approved' ? 'Aprobar y aplicar condonación' : 'Registrar decisión',
        }),
      )
      expect(await within(dialog).findByRole('status')).toHaveTextContent(
        decision === 'approved' ? 'Condonación aplicada' : 'Rechazo registrado',
      )
      await screen.findByText(/No hay condonaciones para revisar/)
      expect(within(dialog).queryByText('Pendiente')).not.toBeInTheDocument()
      expect(decideMock).toHaveBeenCalledWith(
        item().id,
        { decision, reason: 'Verificado', evidence: 'Acta 12' },
        expect.any(String),
      )
      expect(
        within(dialog).getByText(/Aprobar y aplicar mantiene dos controles del servidor/),
      ).toBeInTheDocument()
      expect(
        within(dialog).queryByRole('link', { name: 'Continuar en Cobranza' }),
      ).not.toBeInTheDocument()
      if (decision === 'approved') await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1))
      else expect(executeMock).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  const execution = (executionId: string, overrides = {}) => ({
    execution_id: executionId,
    approval_id: item().id,
    member_id: item().snapshot.member_id,
    currency: 'ARS',
    approved_amount_cents: 12500,
    treatment_ids: ['00000000-0000-4000-8000-000000000071'],
    status: 'executed' as const,
    ...overrides,
  })

  it('posts a valid decision before exactly one matching application and keeps the dialog locked through both phases', async () => {
    let resolveDecision!: (value: ReturnType<typeof recorded>) => void
    let resolveExecution!: (value: ReturnType<typeof execution>) => void
    listQueueMock.mockImplementation(() => {
      const executionId = executeMock.mock.calls[0]?.[1]
      return Promise.resolve(
        page(
          executionId
            ? [
                {
                  ...item(),
                  state: 'executed',
                  decided_at: '2026-09-09T12:00:00.000Z',
                  execution_id: executionId,
                  execution_status: 'executed',
                },
              ]
            : [item()],
        ),
      )
    })
    decideMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDecision = resolve
      }),
    )
    executeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExecution = resolve
      }),
    )
    const user = userEvent.setup()
    renderPage()
    const dialog = await fillDecision(user)
    const submit = within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' })
    await user.click(submit)
    await user.click(submit)
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(executeMock).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toBeDisabled()
    await act(async () => resolveDecision(recorded()))
    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1))
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toBeDisabled()
    const [requestId, executionId, executionKey] = executeMock.mock.calls[0]!
    expect(requestId).toBe(item().id)
    expect(typeof executionId).toBe('string')
    expect(typeof executionKey).toBe('string')
    await act(async () => resolveExecution(execution(executionId)))
    await waitFor(() => expect(listQueueMock).toHaveBeenCalledWith({ view: 'all' }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Condonación aplicada')
  })

  it('does not execute after unmounting during the approved-pending lifecycle read', async () => {
    const lifecycle = deferred()
    const approvedPending = {
      ...item(),
      state: 'approved_awaiting_execution' as const,
      decided_at: '2026-09-09T12:00:00.000Z',
      execution_id: '00000000-0000-4000-8000-000000000070',
      execution_status: 'recoverable' as const,
    }
    listQueueMock.mockResolvedValueOnce(page([item()]))
    decideMock.mockResolvedValueOnce(recorded())
    listLifecycleMock.mockReturnValueOnce(lifecycle.promise)
    const user = userEvent.setup()
    const view = renderPage()
    const dialog = await fillDecision(user)
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    await waitFor(() => expect(listLifecycleMock).toHaveBeenCalledWith(item().snapshot.member_id))
    view.unmount()
    await act(async () => lifecycle.resolve(page([approvedPending])))
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('does not execute after an actor change remounts the queue during lifecycle read', async () => {
    const lifecycle = deferred()
    const approvedPending = {
      ...item(),
      state: 'approved_awaiting_execution' as const,
      decided_at: '2026-09-09T12:00:00.000Z',
      execution_id: '00000000-0000-4000-8000-000000000070',
      execution_status: 'recoverable' as const,
    }
    listQueueMock.mockResolvedValueOnce(page([item()]))
    decideMock.mockResolvedValueOnce(recorded())
    listLifecycleMock.mockReturnValueOnce(lifecycle.promise)
    const user = userEvent.setup()
    const view = renderPage()
    const dialog = await fillDecision(user)
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    await waitFor(() => expect(listLifecycleMock).toHaveBeenCalledWith(item().snapshot.member_id))
    useAuthMock.mockReturnValue(auth('ADMIN', 'operator-2'))
    await act(async () => {
      view.rerender(<ApprovalsListPage />)
    })
    await act(async () => lifecycle.resolve(page([approvedPending])))
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('does not execute after operatorId changes in a mounted dialog', async () => {
    const lifecycle = deferred()
    const approvedPending = {
      ...item(),
      state: 'approved_awaiting_execution' as const,
      decided_at: '2026-09-09T12:00:00.000Z',
      execution_id: '00000000-0000-4000-8000-000000000070',
      execution_status: 'recoverable' as const,
    }
    decideMock.mockResolvedValueOnce(recorded())
    listLifecycleMock.mockReturnValueOnce(lifecycle.promise)
    const user = userEvent.setup()
    const renderDialog = (operatorId: string) => (
      <CondonationDecisionDialog
        request={item()}
        operatorId={operatorId}
        role="ADMIN"
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const view = render(renderDialog('operator-1'))
    const dialog = screen.getByRole('dialog', { name: 'Decidir condonación' })
    await user.type(within(dialog).getByLabelText('Motivo de la decisión'), 'Verificado')
    await user.type(within(dialog).getByLabelText('Evidencia de la decisión'), 'Acta 12')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    await waitFor(() => expect(listLifecycleMock).toHaveBeenCalledWith(item().snapshot.member_id))
    view.rerender(renderDialog('operator-2'))
    await act(async () => lifecycle.resolve(page([approvedPending])))
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Reintentar aplicación' }),
      ).not.toBeDisabled(),
    )
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('keeps a valid approved request pending after application failure and retries only the application POST', async () => {
    listQueueMock.mockResolvedValue(page([item()]))
    decideMock.mockResolvedValueOnce(recorded())
    executeMock
      .mockRejectedValueOnce(new CondonationOperationError('unavailable'))
      .mockImplementationOnce((_requestId, executionId) =>
        Promise.resolve(execution(executionId, { status: 'replayed' })),
      )
    const user = userEvent.setup()
    renderPage()
    const dialog = await fillDecision(user)
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    expect(
      (await within(dialog).findAllByText(/Aprobada pendiente de aplicación/)).length,
    ).toBeGreaterThan(0)
    const firstExecution = executeMock.mock.calls[0]
    await user.click(within(dialog).getByRole('button', { name: 'Reintentar aplicación' }))
    await within(dialog).findByRole('status')
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledTimes(2)
    expect(executeMock.mock.calls[1]).toEqual(firstExecution)
  })

  it('reads approved-pending recovery through view=all without mutating on load or refresh', async () => {
    const approvedPending = {
      ...item(),
      state: 'approved_awaiting_execution' as const,
      decided_at: '2026-09-09T12:00:00.000Z',
      execution_id: '00000000-0000-4000-8000-000000000070',
      execution_status: 'recoverable' as const,
    }
    listQueueMock.mockResolvedValue(page([approvedPending]))
    const user = userEvent.setup()
    renderPage()
    await member('Ana')
    expect(listQueueMock).toHaveBeenCalledWith({ view: 'all' })
    expect(screen.getByText(/Aprobada: pendiente de ejecución/)).toBeInTheDocument()
    expect(decideMock).not.toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(listQueueMock).toHaveBeenCalledTimes(2))
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('explains why the requester needs a different approver', async () => {
    useAuthMock.mockReturnValue(auth('TESORERO', item().requester.id))
    listQueueMock.mockResolvedValueOnce(page([item()]))
    renderPage()
    await member('Ana')
    expect(screen.getByText(/Otro ADMIN o TESORERO debe decidir/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revisar solicitud' })).not.toBeInTheDocument()
    expect(decideMock).not.toHaveBeenCalled()
  })

  it('locks double submits and closing, then discards late completion after an actor change', async () => {
    let resolve!: (value: ReturnType<typeof recorded>) => void
    decideMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    listQueueMock.mockResolvedValueOnce(page([item()]))
    const user = userEvent.setup()
    const view = renderPage()
    const dialog = await fillDecision(user)
    const form = within(dialog).getByLabelText('Motivo de la decisión').closest('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toBeDisabled()
    expect(within(dialog).getByLabelText('Decisión')).toBeDisabled()
    useAuthMock.mockReturnValue(auth('TESORERO', 'operator-2'))
    await act(async () => {
      view.rerender(<ApprovalsListPage />)
    })
    await screen.findByText(/No hay condonaciones/)
    await act(async () => resolve(recorded()))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/Aprobación registrada/)).not.toBeInTheDocument()
    expect(listQueueMock).toHaveBeenCalledTimes(2)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('preserves an ambiguous attempt across queue refresh and retries the identical payload and key', async () => {
    listQueueMock.mockResolvedValueOnce(page([item()]))
    decideMock
      .mockRejectedValueOnce(new CondonationOperationError('unavailable'))
      .mockResolvedValueOnce(recorded())
    const user = userEvent.setup()
    const view = renderPage()
    const dialog = await fillDecision(user)
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    await within(dialog).findByRole('alert')
    const first = decideMock.mock.calls[0]
    await act(async () => {
      await view.client.refetchQueries({ queryKey: ['condonation-queue'] })
    })
    expect(within(dialog).getByLabelText('Motivo de la decisión')).toHaveValue('  Verificado  ')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Aprobada pendiente de aplicación',
    )
    expect(decideMock.mock.calls[1]).toEqual(first)
  })

  it('uses a new key for an explicitly edited decision draft', async () => {
    listQueueMock.mockResolvedValueOnce(page([item()]))
    decideMock.mockRejectedValue(new CondonationOperationError('unavailable'))
    const user = userEvent.setup()
    renderPage()
    const dialog = await fillDecision(user)
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    await within(dialog).findByRole('alert')
    await user.type(within(dialog).getByLabelText('Motivo de la decisión'), ' con cambio')
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    await within(dialog).findByRole('alert')
    expect(decideMock.mock.calls).toHaveLength(2)
    expect(decideMock.mock.calls[1]?.[2]).not.toBe(decideMock.mock.calls[0]?.[2])
    expect(decideMock.mock.calls[1]?.[1].reason).toBe('Verificado   con cambio')
  })

  it('removes a selected decision dialog when queue permission is revoked', async () => {
    listQueueMock.mockResolvedValueOnce(page([item()]))
    const user = userEvent.setup()
    const view = renderPage()
    await fillDecision(user)
    listQueueMock.mockRejectedValueOnce(new CondonationOperationError('permission'))
    await act(async () => {
      await view.client.refetchQueries({ queryKey: ['condonation-queue'] })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permisos')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(decideMock).not.toHaveBeenCalled()
  })

  it('does not confirm a mismatched or incomplete decision response', async () => {
    listQueueMock.mockResolvedValueOnce(page([item()]))
    decideMock
      .mockResolvedValueOnce({ ...recorded(), id: item('Beto', '2').id })
      .mockResolvedValueOnce({ ...recorded(), status: 'pending' })
      .mockResolvedValueOnce({ ...recorded(), decided_at: 'invalid' })
    const user = userEvent.setup()
    renderPage()
    const dialog = await fillDecision(user)
    for (let attempt = 1; attempt <= 3; attempt++) {
      await user.click(
        within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }),
      )
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo confirmar')
      expect(decideMock).toHaveBeenCalledTimes(attempt)
      expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
    }
    expect(listQueueMock).toHaveBeenCalledTimes(1)
    expect(decideMock.mock.calls.map((call) => call[2])).toEqual(
      Array(3).fill(decideMock.mock.calls[0]?.[2]),
    )
  })

  it('refreshes and locks a conflict without automatically posting again', async () => {
    listQueueMock.mockResolvedValueOnce(page([item()]))
    decideMock.mockRejectedValueOnce(new CondonationOperationError('conflict'))
    const user = userEvent.setup()
    renderPage()
    const dialog = await fillDecision(user)
    await user.click(within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/La solicitud cambió/)
    await screen.findByText(/No hay condonaciones/)
    expect(
      within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }),
    ).toBeDisabled()
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY)).toBeNull()
  })

  it.each(['permission', 'partial_data'] as const)(
    'retains the draft and key on %s failure',
    async (kind) => {
      listQueueMock.mockResolvedValueOnce(page([item()]))
      decideMock.mockRejectedValue(new CondonationOperationError(kind))
      const user = userEvent.setup()
      renderPage()
      const dialog = await fillDecision(user)
      await user.click(
        within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }),
      )
      await within(dialog).findByRole('alert')
      await user.click(
        within(dialog).getByRole('button', { name: 'Aprobar y aplicar condonación' }),
      )
      await within(dialog).findByRole('alert')
      expect(decideMock.mock.calls[1]).toEqual(decideMock.mock.calls[0])
      expect(executeMock).not.toHaveBeenCalled()
    },
  )

  it('preserves ADMIN token lookup, disabled empty input, trimming and encoding', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/No hay condonaciones/)
    const input = screen.getByRole('textbox', { name: 'Token de aprobación' })
    const submit = screen.getByRole('button', { name: 'Abrir' })
    expect(submit).toBeDisabled()
    await user.type(input, '   ')
    expect(submit).toBeDisabled()
    expect(pushMock).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '  token/a  ')
    await user.click(submit)
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/approvals/token%2Fa'))
  })
})

describe('Approvals community queue', () => {
  const cwUuids = [
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000105',
  ]
  const cwRequesterId = cwUuids[1]!
  const cwMemberId = cwUuids[2]!
  const cwExecutionId = cwUuids[4]!
  const communityItem = (
    state: 'pending' | 'approved_awaiting_execution' | 'executed' = 'pending',
    requesterId: string = cwRequesterId,
  ): CommunityWorkApi.CommunityWorkQueueItem => ({
    id: cwUuids[0]!,
    state,
    expires_at: '2030-01-01T12:00:00.000Z',
    decided_at: state === 'pending' ? null : '2026-09-01T13:00:00.000Z',
    execution_id: state === 'pending' ? null : cwExecutionId,
    execution_status:
      state === 'approved_awaiting_execution'
        ? 'recoverable'
        : state === 'executed'
          ? 'executed'
          : 'unavailable',
    created_at: '2026-09-01T12:00:00.000Z',
    snapshot: {
      member_id: cwMemberId,
      obligations: [
        {
          obligation_id: cwUuids[3]!,
          currency: 'ARS',
          outstanding_amount_cents: 1250,
        },
      ],
    },
    current_member: {
      id: cwMemberId,
      numero_socio: '77',
      nombre: 'Bruno',
      apellido: 'Díaz',
    },
    requester: { id: requesterId, username: 'operador-turno' },
    context: 'Trabajo comunitario acordado',
    reason: 'Plan comunitario 2026',
    evidence: 'Acta 21',
  })
  const communityPage = (
    items: CommunityWorkApi.CommunityWorkQueueItem[],
    next: string | null = null,
  ) => ({
    items,
    next_cursor: next,
  })
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue(auth())
    listQueueMock.mockReset().mockResolvedValue(page())
    communityQueueMock.mockReset().mockResolvedValue(communityPage([]))
    communityDecideMock.mockReset()
    communityExecuteMock.mockReset()
    communityLifecycleMock.mockReset()
    window.sessionStorage.removeItem(COLLECTIONS_IDEMPOTENCY_STORAGE_KEY)
  })

  it('renders the independent community queue beside the preserved condonation queue', async () => {
    listQueueMock.mockResolvedValue(page([item()]))
    communityQueueMock.mockResolvedValue(communityPage([communityItem()]))
    renderPage()
    await member('Ana')
    expect(communityQueueMock).toHaveBeenCalledWith({ view: 'all' })
    const community = await screen.findByRole('region', {
      name: 'Bandeja de trabajo comunitario',
    })
    expect(within(community).getByRole('heading', { name: /bruno díaz/i })).toBeInTheDocument()
    expect(within(community).getByText('Trabajo comunitario acordado')).toBeInTheDocument()
    expect(within(community).getByText('Plan comunitario 2026')).toBeInTheDocument()
    expect(within(community).getByText('Acta 21')).toBeInTheDocument()
    expect(within(community).getByText('operador-turno')).toBeInTheDocument()
    expect(within(community).getByText(/12,50/)).toBeInTheDocument()
    expect(within(community).getByRole('button', { name: 'Revisar solicitud' })).toBeEnabled()
    expect(within(community).getByText('Pendiente')).toBeInTheDocument()
  })

  it('appends independent community pages and stops at the end', async () => {
    const user = userEvent.setup()
    communityQueueMock
      .mockResolvedValueOnce(communityPage([communityItem()], 'cursor-2'))
      .mockResolvedValueOnce(communityPage([communityItem('executed')]))
    renderPage()
    await screen.findByRole('heading', { name: /bruno díaz/i })
    await user.click(screen.getByRole('button', { name: 'Traer más' }))
    expect(await screen.findByText('Ejecutada')).toBeInTheDocument()
    expect(communityQueueMock).toHaveBeenLastCalledWith({ view: 'all', cursor: 'cursor-2' })
  })

  it('reports community permission failures without disturbing the condonation queue', async () => {
    const user = userEvent.setup()
    listQueueMock.mockResolvedValue(page([item()]))
    communityQueueMock.mockRejectedValue(
      new CommunityWorkOperationError('permission', new Error('403')),
    )
    renderPage()
    await member('Ana')
    expect(await screen.findByRole('alert')).toHaveTextContent(/no tenés permisos/i)
    expect(screen.getByRole('button', { name: 'Volver a intentar' })).toBeEnabled()
    communityQueueMock.mockResolvedValue(communityPage([communityItem()]))
    await user.click(screen.getByRole('button', { name: 'Volver a intentar' }))
    expect(await screen.findByRole('heading', { name: /bruno díaz/i })).toBeInTheDocument()
  })

  it('keeps the decision away from the requesting operator and offers it to the other', async () => {
    communityQueueMock.mockResolvedValue(communityPage([communityItem('pending', 'operator-1')]))
    const { unmount } = renderPage()
    await screen.findByRole('heading', { name: /bruno díaz/i })
    expect(
      screen.getByText(/otro admin o tesorero debe decidir esta solicitud que enviaste vos/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revisar solicitud' })).not.toBeInTheDocument()
    unmount()

    communityQueueMock.mockResolvedValue(communityPage([communityItem()]))
    renderPage()
    await screen.findByRole('heading', { name: /bruno díaz/i })
    expect(screen.getByRole('button', { name: 'Revisar solicitud' })).toBeEnabled()
  })

  it('opens the community decision dialog from the queue row', async () => {
    const user = userEvent.setup()
    communityQueueMock.mockResolvedValue(communityPage([communityItem()]))
    renderPage()
    await screen.findByRole('heading', { name: /bruno díaz/i })
    await user.click(screen.getByRole('button', { name: 'Revisar solicitud' }))
    expect(
      await screen.findByRole('dialog', { name: /decidir trabajo comunitario/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Motivo de la decisión')).toBeInTheDocument()
  })

  it('ignores the previous actor community response after switching operators', async () => {
    communityQueueMock.mockImplementation(() => new Promise(() => undefined))
    const { rerender } = render(<ApprovalsListPage />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={clients[0] ?? new QueryClient()}>
          {children}
        </QueryClientProvider>
      ),
    })
    await act(async () => {
      useAuthMock.mockReturnValue(auth('ADMIN', 'operator-2'))
      rerender(<ApprovalsListPage />)
    })
    expect(communityQueueMock).toHaveBeenCalledTimes(2)
    expect(communityQueueMock).toHaveBeenNthCalledWith(2, { view: 'all' })
  })

  it('prevents overlapping community pagination and refresh requests', async () => {
    const user = userEvent.setup()
    communityQueueMock
      .mockResolvedValueOnce(communityPage([communityItem()], 'cursor-2'))
      .mockImplementation(() => new Promise(() => undefined))
    renderPage()
    await screen.findByRole('heading', { name: /bruno díaz/i })
    const loadMore = screen.getByRole('button', { name: 'Traer más' })
    await user.click(loadMore)
    await user.click(screen.getByRole('button', { name: 'Refrescar bandeja' }))
    expect(communityQueueMock).toHaveBeenCalledTimes(2)
  })

  it('offers execution of an approved request through the dialog while marking recovery', async () => {
    const user = userEvent.setup()
    communityQueueMock.mockResolvedValue(
      communityPage([communityItem('approved_awaiting_execution')]),
    )
    renderPage()
    await screen.findByRole('heading', { name: /bruno díaz/i })
    expect(screen.getByText('Recuperación requerida')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ejecutar trabajo comunitario' }))
    const dialog = await screen.findByRole('dialog', { name: /decidir trabajo comunitario/i })
    expect(within(dialog).getByRole('button', { name: /reintentar ejecución/i })).toBeEnabled()
  })
})
