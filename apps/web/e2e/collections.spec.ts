import {
  assertInteractiveNames,
  assertNoPageOverflow,
  allowExpectedResponseFailure,
  expect,
  mockEmptyDisciplines,
  mockEmptyDuesPrices,
  test,
} from './fixtures/authenticated-dashboard'

const collectionsEnabled = process.env.NATIVE_COLLECTIONS_WEB_ENABLED === 'true'

test('unauthenticated user is redirected from Socios', async ({ page }) => {
  await page.goto('/socios')

  await expect(page).toHaveURL(/\/login\?from=%2Fsocios$/, { timeout: 15_000 })
})

test('disabled Collections direct access is denied by default', async ({
  authenticatedPage: page,
}) => {
  test.skip(collectionsEnabled, 'This scenario proves the default-off rollout state.')

  await page.goto('/collections')

  await expect(page.getByText('La cobranza está deshabilitada actualmente.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Collections', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Cobranza', exact: true })).toHaveCount(0)
})

test('enabled ADMIN can navigate Collections and recover keyboard focus', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')

  await mockEmptyDuesPrices(page)
  await mockEmptyDisciplines(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/collections')

  await expect(page.getByRole('heading', { name: 'Cobranza', exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Configuración de cuotas', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Vista previa de evaluación', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('main').getByText(/ctacte|reconciliation/i)).toHaveCount(0)
  await assertNoPageOverflow(page)
  await assertInteractiveNames(page)
  const trigger = page.getByRole('button', { name: 'Abrir navegación' })
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: 'Navegación principal' })
  const collectionsLink = drawer.getByRole('link', { name: 'Collections', exact: true })
  await expect(collectionsLink).toBeVisible()

  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Tab')
  await expect(collectionsLink).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

test('enabled TESORERO can preview assessments without pricing controls or projection requests', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')
  const projectionRequests: string[] = []
  page.on('request', (request) => {
    if (/ctacte|projection|reconciliation/i.test(request.url()))
      projectionRequests.push(request.url())
  })
  await page.addInitScript(() => {
    const value = window.localStorage.getItem('athlos.auth')
    if (!value) return
    const state = JSON.parse(value) as { currentUser: { role: string } }
    state.currentUser.role = 'TESORERO'
    window.localStorage.setItem('athlos.auth', JSON.stringify(state))
  })
  await mockEmptyDuesPrices(page)
  await mockEmptyDisciplines(page)
  await page.goto('/collections')

  await expect(
    page.getByRole('heading', { name: 'Vista previa de evaluación', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar cuota' })).toHaveCount(0)

  expect(projectionRequests).toEqual([])
})

test('enabled unauthorized operator receives a direct route denial', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')

  await page.addInitScript(() => {
    const value = window.localStorage.getItem('athlos.auth')
    if (!value) return
    const state = JSON.parse(value) as { currentUser: { role: string } }
    state.currentUser.role = 'OPERADOR'
    window.localStorage.setItem('athlos.auth', JSON.stringify(state))
  })
  await page.goto('/collections')

  await expect(page.getByText('No tenés permiso para usar la cobranza.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cobranza', exact: true })).toHaveCount(0)
})

// prettier-ignore
const debtSocio={id:'00000000-0000-4000-8000-000000000010',nombre:'Ana',apellido:'Gorriti',numero_socio:'42'}
// prettier-ignore
const debtFixture={status:'ready',socio_id:debtSocio.id,currency:'ARS',total_debt_cents:10_000,obligations:[{id:'obligation-1',period_start:'2026-01-01',period_end:'2026-02-01',original_amount_cents:12_500,outstanding_cents:10_000,currency:'ARS',status:'OPEN',components:[{id:'component-1',kind:'BASE',component_key:'base',amount_cents:12_500}],benefits:[],allocations:[{id:'allocation-1',settlement_id:'settlement-1',settlement_kind:'MONETARY',settlement_amount_cents:2_500,currency:'ARS',amount_cents:2_500,kind:'ALLOCATION',compensates_allocation_id:null,reversal_eligible:true}]}]}
test('enabled ADMIN keeps selected debt cards usable at narrow width', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')
  await mockEmptyDuesPrices(page)
  await mockEmptyDisciplines(page)
  await page.route('**/api/v1/socios?*', (route) =>
    route.fulfill({ json: { items: [debtSocio], page: 1, limit: 20, total: 1, has_more: false } }),
  )
  await page.route('**/api/v1/dues/debt/*', (route) => route.fulfill({ json: debtFixture }))
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/collections')
  await page.getByRole('searchbox', { name: 'Buscar socio' }).fill('Gorriti')
  await page.getByRole('button', { name: 'Buscar socio' }).click()
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await expect(page.getByRole('list', { name: 'Obligaciones de deuda' })).toBeVisible()
  await expect(page.getByText(/settlement-1 · MONETARY: 25.00 ARS/)).toBeVisible()

  await assertNoPageOverflow(page)
  await assertInteractiveNames(page)
})

test('enabled ADMIN records an allocation and appends a keyboard reversal on mobile', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')
  let attempts = 0
  await mockEmptyDuesPrices(page)
  await mockEmptyDisciplines(page)
  await page.route('**/api/v1/socios?*', (route) =>
    route.fulfill({ json: { items: [debtSocio], page: 1, limit: 20, total: 1, has_more: false } }),
  )
  await page.route('**/api/v1/dues/debt/*', (route) => route.fulfill({ json: debtFixture }))
  await page.route('**/api/v1/treasury/shifts', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'shift-1',
            desk_id: 'desk-1',
            status: 'OPEN',
            business_date: '2026-01-01',
            assigned_operator_id: 'operator-1',
            opened_at: '2026-01-01T08:00:00.000Z',
            closed_at: null,
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/dues/settlements', (route) => {
    attempts += 1
    return route.fulfill({
      status: 201,
      json: {
        settlement_id: 'settlement-2',
        kind: 'MONETARY',
        amount_cents: 2_000,
        currency: 'ARS',
        allocations: [],
      },
    })
  })
  await page.route('**/api/v1/dues/settlements/*/reverse', (route) =>
    route.fulfill({
      status: 201,
      json: {
        original_settlement_id: 'settlement-1',
        reversal_settlement_id: 'reversal-1',
        kind: 'MONETARY',
        amount_cents: 2_500,
        currency: 'ARS',
        allocations: [],
      },
    }),
  )
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/collections')
  await page.getByRole('searchbox', { name: 'Buscar socio' }).fill('Gorriti')
  await page.getByRole('button', { name: 'Buscar socio' }).click()
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await page.getByRole('button', { name: /registrar pago/i }).click()
  await page.getByRole('checkbox', { name: /^Período 2026-01-01:/i }).check()
  await page.getByRole('button', { name: /confirmar pago/i }).click()
  await expect(page.getByRole('status').filter({ hasText: /pago registrado/i })).toBeVisible()
  const reversal = page.getByRole('button', { name: /revertir liquidación settlement-1/i })
  await reversal.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('list', { name: 'Asignaciones afectadas' })).toContainText(
    /obligación 2026-01-01/i,
  )
  await page.keyboard.insertText('Asignación incorrecta')
  await page.getByRole('button', { name: /confirmar reversión/i }).focus()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('status').filter({ hasText: /compensación/i })).toBeVisible()
  expect(attempts).toBe(1)
  await expect(page.getByRole('main', { name: 'Cobranza' })).not.toHaveText(
    /caja|conciliación|tesorería/i,
  )

  await assertNoPageOverflow(page)
})

const lifecycleId = '00000000-0000-4000-8000-000000000020'
const executionId = '00000000-0000-4000-8000-000000000021'
const operatorId = '00000000-0000-4000-8000-000000000001'
const lifecycleItem = (state: string, executionStatus = 'executed') => ({
  id: lifecycleId,
  state,
  expires_at: '2026-12-31T00:00:00.000Z',
  decided_at: state === 'pending' ? null : '2026-08-01T00:00:00.000Z',
  used_at: state === 'executed' ? '2026-08-02T00:00:00.000Z' : null,
  execution_id: executionId,
  execution_status: executionStatus,
  snapshot: {
    member_id: debtSocio.id,
    obligations: [
      {
        obligation_id: '00000000-0000-4000-8000-000000000022',
        currency: 'ARS',
        outstanding_amount_cents: 10_000,
      },
    ],
  },
  requester: { operator_id: operatorId },
  reason: 'Situación excepcional',
  evidence: 'Acta 12',
  decision: state === 'pending' ? null : { reason: 'Aprobada', evidence: 'Acta 13' },
})

async function mockSelectedDebt(
  page: Parameters<typeof mockEmptyDuesPrices>[0],
  debt = debtFixture,
) {
  await mockEmptyDuesPrices(page)
  await mockEmptyDisciplines(page)
  await page.route('**/api/v1/socios?*', (route) =>
    route.fulfill({ json: { items: [debtSocio], page: 1, limit: 20, total: 1, has_more: false } }),
  )
  await page.route('**/api/v1/dues/debt/*', (route) => route.fulfill({ json: debt }))
}

async function selectDebt(page: Parameters<typeof mockEmptyDuesPrices>[0]) {
  await page.getByRole('searchbox', { name: 'Buscar socio' }).fill('Gorriti')
  await page.getByRole('button', { name: 'Buscar socio' }).click()
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await expect(page.getByRole('heading', { name: 'Tratamientos de deuda' })).toBeVisible()
}

test('treatments preserve four named keyboard-accessible sections from narrow to wide without CTActe', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')
  const forbiddenRequests: string[] = []
  page.on('request', (request) => {
    if (/ctacte/i.test(request.url())) forbiddenRequests.push(request.url())
  })
  await mockSelectedDebt(page)
  await page.route('**/api/v1/members/*/condonation-requests?*', (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/collections')
    await selectDebt(page)
    const workspace = page.getByRole('region', { name: 'Tratamientos de deuda' })
    await expect(workspace.getByRole('heading', { level: 3 })).toHaveText([
      'Pago',
      'Trabajo comunitario',
      'Acuerdo',
      'Condonación',
    ])
    await assertNoPageOverflow(page)
    await assertInteractiveNames(page)
    await expect(workspace).not.toContainText(/ctacte/i)
    await page.getByRole('button', { name: 'Enviar solicitud de condonación' }).focus()
    await expect(
      page.getByRole('button', { name: 'Enviar solicitud de condonación' }),
    ).toBeFocused()
  }
  expect(forbiddenRequests).toEqual([])
})

test('condonation lifecycle stays honest through reload, execution, replay recovery, and stale failure', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')
  let state = 'pending'
  let executionStatus = 'executed'
  let debtRequests = 0
  const executions: string[] = []
  await mockSelectedDebt(page)
  await page.route('**/api/v1/treasury/shifts', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'shift-1',
            desk_id: 'desk-1',
            status: 'OPEN',
            business_date: '2026-01-01',
            assigned_operator_id: 'operator-1',
            opened_at: '2026-01-01T08:00:00.000Z',
            closed_at: null,
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/dues/debt/*', (route) => {
    debtRequests += 1
    return route.fulfill({
      json: { ...debtFixture, total_debt_cents: state === 'executed' ? 0 : 10_000 },
    })
  })
  await page.route('**/api/v1/members/*/condonation-requests?*', (route) =>
    route.fulfill({ json: { items: [lifecycleItem(state, executionStatus)] } }),
  )
  await page.route('**/api/v1/condonation-requests/*/execution', async (route) => {
    executions.push(JSON.parse(route.request().postData() ?? '{}').execution_id)
    if (state === 'approved_awaiting_execution' && executionStatus === 'recoverable')
      return route.fulfill({ status: 409, json: {} })
    state = 'executed'
    return route.fulfill({
      json: {
        execution_id: executionId,
        approval_id: lifecycleId,
        member_id: debtSocio.id,
        currency: 'ARS',
        approved_amount_cents: 10_000,
        treatment_ids: ['00000000-0000-4000-8000-000000000023'],
        status: executionStatus === 'recoverable' ? 'replayed' : 'executed',
      },
    })
  })
  await page.goto('/collections')
  await selectDebt(page)
  await expect(page.getByText('Pendiente: la deuda no cambia.')).toBeVisible()
  await page.reload()
  await selectDebt(page)
  await expect(page.getByText('Pendiente: la deuda no cambia.')).toBeVisible()
  state = 'rejected'
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await expect(page.getByText('Rechazada: la deuda no cambia.')).toBeVisible()
  expect(debtRequests).toBeGreaterThan(2)

  state = 'approved_awaiting_execution'
  executionStatus = 'executed'
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await expect(page.getByText('Aprobada, pero todavía no fue aplicada a la deuda.')).toBeVisible()
  await page.getByRole('button', { name: 'Ejecutar condonación' }).click()
  await expect(page.getByText(/Ejecutada: la deuda autorizada se redujo/)).toBeVisible()
  await expect(
    page
      .getByLabel(/Resumen de deuda de Gorriti, Ana/)
      .getByText('Deuda total pendiente: 0.00 ARS', { exact: true }),
  ).toBeVisible()
  expect(executions).toEqual([executionId])
  await expect(page.getByRole('button', { name: /Ejecutar|Recuperar/ })).toHaveCount(0)

  state = 'approved_awaiting_execution'
  executionStatus = 'recoverable'
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  const recovery = page.getByRole('button', { name: 'Recuperar y ejecutar condonación' })
  allowExpectedResponseFailure(page, {
    url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '3101'}/api/v1/condonation-requests/${lifecycleId}/execution`,
    status: 409,
    request: { method: 'POST', postData: JSON.stringify({ execution_id: executionId }) },
    context: 'stale condonation execution',
  })
  await recovery.click()
  await expect(
    page.getByRole('region', { name: 'Estado de la condonación' }).getByRole('alert'),
  ).toContainText(/requiere recuperación/i)
  await expect(recovery).toBeFocused()
  await expect(
    page
      .getByLabel(/Resumen de deuda de Gorriti, Ana/)
      .getByText('Deuda total pendiente: 100.00 ARS', { exact: true }),
  ).toBeVisible()
  expect(executions).toEqual([executionId, executionId])
})

test('OPERADOR can inspect condonation without settlement, decision, or execution controls', async ({
  authenticatedPage: page,
}) => {
  test.skip(!collectionsEnabled, 'Run with NATIVE_COLLECTIONS_WEB_ENABLED=true.')
  await page.addInitScript(() => {
    const state = JSON.parse(window.localStorage.getItem('athlos.auth')!) as {
      currentUser: { role: string }
    }
    state.currentUser.role = 'OPERADOR'
    window.localStorage.setItem('athlos.auth', JSON.stringify(state))
  })
  await mockSelectedDebt(page)
  await page.route('**/api/v1/members/*/condonation-requests?*', (route) =>
    route.fulfill({ json: { items: [lifecycleItem('approved_awaiting_execution')] } }),
  )
  await page.goto('/collections')
  await selectDebt(page)
  await expect(page.getByRole('heading', { name: 'Solicitud de condonación' })).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: /registrar pago|revertir|registrar decisión|ejecutar|recuperar/i,
    }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: /No tenés permiso para registrar pagos/i }),
  ).toBeVisible()
})
