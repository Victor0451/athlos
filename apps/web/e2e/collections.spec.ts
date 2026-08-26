import {
  assertInteractiveNames,
  assertNoPageOverflow,
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
        settlement_id: 'reversal-1',
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
  await page.getByLabel(/importe del período 2026-01-01/i).fill('2000')
  await page.getByRole('button', { name: /confirmar pago/i }).click()
  await expect(page.getByRole('status').filter({ hasText: /pago registrado/i })).toBeVisible()
  await page.getByRole('button', { name: /revertir allocation-1/i }).click()
  await page.getByLabel(/motivo de reversión/i).fill('Asignación incorrecta')
  await page.getByRole('button', { name: /confirmar reversión/i }).click()

  await expect(page.getByRole('status').filter({ hasText: /compensación/i })).toBeVisible()
  expect(attempts).toBe(1)
  await expect(page.getByRole('main', { name: 'Cobranza' })).not.toHaveText(
    /caja|conciliación|tesorería/i,
  )

  await assertNoPageOverflow(page)
})
