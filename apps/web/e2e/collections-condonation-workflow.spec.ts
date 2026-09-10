import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

const mode = process.env.ATHLOS_CONDONATION_QA_MODE ?? 'smoke'
if (!['manual', 'smoke'].includes(mode)) throw new Error('Invalid ATHLOS_CONDONATION_QA_MODE')
if (mode === 'manual' && process.env.CI) throw new Error('Manual condonation QA cannot run in CI')
const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
const member = { id: id('10'), nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
const obligationId = id('11')
const requestId = id('12')
const executionId = id('13')
const treatmentId = id('14')
const actors = { OPERADOR: id('15'), TESORERO: id('16') }
type Actor = keyof typeof actors
type State = 'none' | 'pending' | 'approved' | 'rejected' | 'executed'

test(`condonation ${mode}: separate request, decision and execution`, async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(mode === 'manual' ? 30 * 60_000 : 90_000)
  test.skip(process.env.NATIVE_COLLECTIONS_WEB_ENABLED !== 'true', 'Requires native Collections')
  if (mode === 'manual' && test.info().project.use.headless !== false)
    throw new Error('Manual condonation QA requires --headed')
  if (!baseURL) throw new Error('Local baseURL required')
  const origin = new URL(baseURL)
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.username ||
    origin.password
  )
    throw new Error('Condonation QA only permits loopback HTTP')
  const contexts: BrowserContext[] = []
  const unexpected: string[] = []
  let state: State = 'none'
  let outstanding = 10_000
  let requests = 0
  let decisions = 0
  let executions = 0
  let requestKey = ''
  let requestFingerprint = ''
  let decisionKey = ''
  let decisionFingerprint = ''
  let requesterId = ''
  let approverId = ''
  let requestContext = ''
  let requestReason = ''
  let requestEvidence = ''
  let createdAt = ''
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
  let decidedAt: string | null = null
  const requestDto = () => ({
    id: requestId,
    status: state === 'executed' ? 'approved' : state,
    expires_at: expiresAt,
    decided_at: decidedAt,
  })
  const history = () => ({
    id: requestId,
    state: state === 'approved' ? 'approved_awaiting_execution' : state,
    expires_at: expiresAt,
    decided_at: decidedAt,
    execution_id: state === 'approved' || state === 'executed' ? executionId : null,
    execution_status:
      state === 'executed' ? 'executed' : state === 'approved' ? 'recoverable' : 'unavailable',
    snapshot: {
      member_id: member.id,
      obligations: [
        { obligation_id: obligationId, currency: 'ARS', outstanding_amount_cents: 10_000 },
      ],
    },
  })
  const debt = () => ({
    status: 'ready',
    socio_id: member.id,
    currency: 'ARS',
    total_debt_cents: outstanding,
    obligations: [
      {
        id: obligationId,
        period_start: '2026-01-01',
        period_end: '2026-02-01',
        original_amount_cents: 10_000,
        outstanding_cents: outstanding,
        currency: 'ARS',
        status: outstanding ? 'OPEN' : 'PAID',
        components: [],
        benefits: [],
        allocations: [],
      },
    ],
  })
  const send = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, json: body })
  const fail = (route: Route, status: number, message: string) =>
    send(route, status, {
      error:
        status === 403
          ? 'INSUFFICIENT_PERMISSIONS'
          : status === 409
            ? 'CONFLICT'
            : 'VALIDATION_ERROR',
      message: `Simulador de condonación: ${message}`,
      request_id: 'condonation-qa',
    })

  async function api(route: Route, actor: Actor) {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method === 'GET') {
      if (path === '/api/v1/club-status')
        return send(route, 200, {
          period: 'current-month',
          generatedAt: new Date().toISOString(),
          membership: { active: 1 },
          freshness: [],
          unavailable: [],
          finance: { debits: '0', credits: '0', net: '0' },
        })
      if (path === '/api/v1/notifications/unread-count') return send(route, 200, { count: 0 })
      if (
        [
          '/api/v1/notifications',
          '/api/v1/dues/prices',
          '/api/v1/padrones/disciplinas',
          '/api/v1/treasury/shifts',
        ].includes(path)
      )
        return send(route, 200, { items: [] })
      if (path === '/api/v1/admin/operations/snapshot')
        return send(route, 200, {
          readiness: { overall: 'ready', db: 'ready', schema: 'ready' },
          freshness: { available: true, items: [] },
          jobs: { available: true, items: [] },
          attention: { available: true, items: [] },
        })
      if (path === '/api/v1/socios')
        return send(route, 200, { items: [member], page: 1, limit: 20, total: 1, has_more: false })
      if (path === `/api/v1/socios/${member.id}`) return send(route, 200, member)
      if (path === '/api/v1/condonation-requests') {
        const view = new URL(request.url()).searchParams.get('view')
        const visible = state === 'pending' || view === 'all'
        return send(route, 200, {
          items:
            visible && state !== 'none'
              ? [
                  {
                    ...history(),
                    created_at: createdAt,
                    current_member: member,
                    requester: { id: requesterId, username: 'qa.operador' },
                    context: requestContext,
                    reason: requestReason,
                    evidence: requestEvidence,
                  },
                ]
              : [],
          next_cursor: null,
        })
      }
      if (path === `/api/v1/dues/debt/${member.id}`) return send(route, 200, debt())
      if (path === `/api/v1/members/${member.id}/condonation-requests`)
        return send(route, 200, { items: state === 'none' ? [] : [history()] })
    }
    if (method === 'POST' && path.startsWith('/api/v1/condonation-requests')) {
      let input: Record<string, unknown>
      try {
        input = request.postDataJSON()
      } catch {
        return fail(route, 400, 'JSON no válido.')
      }
      const key = request.headers()['idempotency-key']
      if (!input || typeof input !== 'object' || !key)
        return fail(route, 400, 'Faltan datos o clave de operación.')
      const text = (name: string, max: number) =>
        typeof input[name] === 'string' &&
        String(input[name]).trim().length > 0 &&
        String(input[name]).trim().length <= max
      if (path === '/api/v1/condonation-requests') {
        if (
          input.member_id !== member.id ||
          JSON.stringify(input.obligation_ids) !== JSON.stringify([obligationId]) ||
          !text('context', 1000) ||
          !text('reason', 500) ||
          !text('evidence', 1000)
        )
          return fail(
            route,
            400,
            'Seleccioná la obligación de Ana y completá contexto, motivo y evidencia.',
          )
        const fingerprint = JSON.stringify([
          input.member_id,
          input.obligation_ids,
          ...['context', 'reason', 'evidence'].map((name) => String(input[name]).trim()),
        ])
        if (state !== 'none')
          return key === requestKey &&
            fingerprint === requestFingerprint &&
            requesterId === actors[actor]
            ? send(route, 201, requestDto())
            : fail(route, 409, 'Esta prueba admite una solicitud; recuperá la existente.')
        requesterId = actors[actor]
        requestKey = key
        requestFingerprint = fingerprint
        requestContext = String(input.context).trim()
        requestReason = String(input.reason).trim()
        requestEvidence = String(input.evidence).trim()
        createdAt = new Date().toISOString()
        state = 'pending'
        requests += 1
        return send(route, 201, requestDto())
      }
      if (path === `/api/v1/condonation-requests/${requestId}/decision`) {
        if (actor !== 'TESORERO' || actors[actor] === requesterId)
          return fail(route, 403, 'La decisión requiere Tesorería y otra persona solicitante.')
        if (
          (input.decision !== 'approved' && input.decision !== 'rejected') ||
          !text('reason', 500) ||
          !text('evidence', 1000)
        )
          return fail(route, 400, 'Completá decisión, motivo y evidencia.')
        const fingerprint = JSON.stringify([
          input.decision,
          String(input.reason).trim(),
          String(input.evidence).trim(),
        ])
        if (state !== 'pending')
          return key === decisionKey &&
            fingerprint === decisionFingerprint &&
            approverId === actors[actor]
            ? send(route, 200, requestDto())
            : fail(route, 409, 'La solicitud ya no está pendiente.')
        if (Date.now() >= Date.parse(expiresAt)) return fail(route, 409, 'La solicitud venció.')
        approverId = actors[actor]
        decisionKey = key
        decisionFingerprint = fingerprint
        decidedAt = new Date().toISOString()
        state = input.decision
        decisions += 1
        return send(route, 200, requestDto())
      }
      if (path === `/api/v1/condonation-requests/${requestId}/execution`) {
        if (actor !== 'TESORERO') return fail(route, 403, 'La ejecución requiere Tesorería.')
        if (typeof input.execution_id !== 'string')
          return fail(route, 400, 'Falta la referencia de ejecución.')
        if (
          input.execution_id !== executionId ||
          actors[actor] !== approverId ||
          (state !== 'approved' && state !== 'executed') ||
          Date.now() >= Date.parse(expiresAt)
        )
          return fail(route, 409, 'La aprobación no permite esta ejecución.')
        const replayed = state === 'executed'
        if (!replayed && outstanding !== 10_000)
          return fail(route, 409, 'El saldo cambió desde la solicitud.')
        if (!replayed) {
          state = 'executed'
          outstanding = 0
          executions += 1
        }
        return send(route, 200, {
          execution_id: executionId,
          approval_id: requestId,
          member_id: member.id,
          currency: 'ARS',
          approved_amount_cents: 10_000,
          treatment_ids: [treatmentId],
          status: replayed ? 'replayed' : 'executed',
        })
      }
    }
    unexpected.push(`${actor} ${method} ${path}`)
    return fail(route, 400, 'Esta ruta no está habilitada en la prueba.')
  }

  async function openActor(actor: Actor) {
    const context = await browser.newContext({
      baseURL: origin.origin,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 900 },
    })
    contexts.push(context)
    await context.addInitScript(
      ({ localOrigin, currentUser }) => {
        if (location.origin === localOrigin)
          localStorage.setItem(
            'athlos.auth',
            JSON.stringify({
              accessToken: `qa-${currentUser.role}`,
              refreshToken: 'qa-refresh',
              currentUser,
            }),
          )
      },
      {
        localOrigin: origin.origin,
        currentUser: {
          operator_id: actors[actor],
          role: actor,
          username: `qa.${actor.toLowerCase()}`,
          permissions: { can_reprint: false, can_anulate: false, data_steward: false },
        },
      },
    )
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin.origin) {
        unexpected.push(`Blocked external request: ${url.origin}`)
        return route.abort('blockedbyclient')
      }
      return url.pathname.startsWith('/api/') ? api(route, actor) : route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => unexpected.push(error.message))
    await page.goto(actor === 'TESORERO' ? '/admin/approvals' : '/collections')
    if (actor === 'TESORERO')
      await expect(page.getByRole('heading', { name: 'Aprobaciones' })).toBeVisible()
    else await expect(page.getByLabel('Buscar socio', { exact: true })).toBeVisible()
    await page.evaluate((role) => {
      document.title = `SIMULADOR · ${role} · Condonación`
      const badge = document.createElement('aside')
      badge.textContent =
        role === 'OPERADOR'
          ? 'SIMULADOR · OPERADOR · Paso 1: completá y enviá la solicitud de Ana. No cambia la deuda. Sin datos reales.'
          : 'SIMULADOR · TESORERO · Paso 2: en Aprobaciones, actualizá y verificá la solicitud. Aprobá y aplicá explícitamente allí. Sin datos reales.'
      badge.style.cssText =
        'position:fixed;bottom:12px;left:8px;max-width:200px;padding:8px;background:#fff;border:2px solid #333;font:12px sans-serif;z-index:1000'
      document.body.appendChild(badge)
    }, actor)
    return page
  }
  async function selectMember(page: Page) {
    await page.getByLabel('Buscar socio', { exact: true }).fill('Gorriti')
    await page.getByRole('button', { name: 'Buscar socio', exact: true }).click()
    await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
    await expect(page.getByRole('heading', { name: 'Tratamientos de deuda' })).toBeVisible()
  }
  const balance = (page: Page, pesos: string) =>
    expect(page.getByText(new RegExp(`Deuda total pendiente:\\s*\\$\\s*${pesos},00`))).toBeVisible()
  try {
    const requester = await openActor('OPERADOR')
    const treasurer = await openActor('TESORERO')
    await selectMember(requester)
    expect(state).toBe('none')
    await balance(requester, '100')
    await expect(treasurer.getByText(/No hay condonaciones para revisar/)).toBeVisible()
    await expect(requester.getByText(/SIMULADOR · OPERADOR · Paso 1/)).toBeVisible()
    await expect(treasurer.getByText(/SIMULADOR · TESORERO · Paso 2/)).toBeVisible()
    if (mode === 'manual') {
      await requester.bringToFront()
      process.stdout.write(
        'CONDONATION_QA_READY actors=OPERADOR,TESORERO api=simulated; human acceptance is separate\n',
      )
      await requester.pause()
      expect(unexpected).toEqual([])
      test.skip(true, 'Human session ended; not an automated acceptance verdict')
      return
    }
    const draft = {
      member_id: member.id,
      obligation_ids: [obligationId],
      context: 'Situación social verificada.',
      reason: 'Imposibilidad económica temporal.',
      evidence: 'Informe social QA-2026-01.',
    }
    await requester
      .getByRole('list', { name: 'Obligaciones seleccionables' })
      .getByRole('checkbox')
      .check()
    await requester.getByLabel('Contexto de la solicitud').fill(draft.context)
    await requester.getByLabel('Motivo de la solicitud').fill(draft.reason)
    await requester.getByLabel('Evidencia de la solicitud').fill(draft.evidence)
    await requester.getByRole('button', { name: 'Enviar solicitud de condonación' }).click()
    await expect(
      requester.getByText('Solicitud pendiente. No modifica la deuda ni ejecuta una condonación.'),
    ).toBeVisible()
    await balance(requester, '100')
    expect({ requests, decisions, executions }).toEqual({
      requests: 1,
      decisions: 0,
      executions: 0,
    })
    await expect(
      requester.getByRole('button', { name: /Registrar decisión|ejecutar condonación/i }),
    ).toHaveCount(0)
    const decision = {
      decision: 'approved',
      reason: 'Informe verificado por Tesorería.',
      evidence: 'Acta QA-2026-01.',
    }
    await treasurer.getByRole('button', { name: 'Actualizar' }).click()
    await expect(treasurer.getByRole('heading', { name: /Ana Gorriti · N.º 42/ })).toBeVisible()
    for (const text of [draft.context, draft.reason, draft.evidence, 'qa.operador'])
      await expect(treasurer.getByText(text, { exact: true })).toBeVisible()
    await treasurer.getByRole('button', { name: 'Revisar solicitud' }).click()
    const dialog = treasurer.getByRole('dialog', { name: 'Decidir condonación' })
    await dialog.getByLabel('Motivo de la decisión').fill(decision.reason)
    await dialog.getByLabel('Evidencia de la decisión').fill(decision.evidence)
    await dialog.getByRole('button', { name: 'Aprobar y aplicar condonación' }).click()
    await expect(dialog.getByText('Condonación aplicada.')).toBeVisible()
    expect(dialog.getByRole('link', { name: 'Continuar en Cobranza' })).toHaveCount(0)
    expect({ decisions, executions, outstanding }).toEqual({
      decisions: 1,
      executions: 1,
      outstanding: 0,
    })
    await treasurer.goto('/collections')
    await selectMember(treasurer)
    await balance(treasurer, '0')
    await expect(treasurer.getByText('Ejecutada', { exact: true })).toBeVisible()
    await expect(
      treasurer.getByRole('button', { name: /^(Recuperar y ejecutar|Ejecutar) condonación$/ }),
    ).toHaveCount(0)
    expect({ requests, decisions, executions }).toEqual({
      requests: 1,
      decisions: 1,
      executions: 1,
    })
    expect(unexpected).toEqual([])
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
