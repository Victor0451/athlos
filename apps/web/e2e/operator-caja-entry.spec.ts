import { expect, test } from './fixtures/authenticated-dashboard'

test('OPERADOR opens Caja on mobile without finance-only controls', async ({
  authenticatedPage: page,
}) => {
  const openingRequests: unknown[] = []
  let opened = false

  await page.addInitScript(() => {
    const state = JSON.parse(window.localStorage.getItem('athlos.auth')!) as {
      currentUser: { role: string }
    }
    state.currentUser.role = 'OPERADOR'
    window.localStorage.setItem('athlos.auth', JSON.stringify(state))
  })
  await page.route('**/api/v1/treasury/shifts', (route) => {
    if (route.request().method() === 'POST') {
      openingRequests.push(JSON.parse(route.request().postData() ?? '{}'))
      opened = true
      return route.fulfill({
        status: 201,
        json: {
          id: 'own-open',
          desk_id: 'front-desk',
          status: 'OPEN',
          business_date: '2026-01-01',
          assigned_operator_id: '00000000-0000-4000-8000-000000000001',
          opened_at: new Date().toISOString(),
          closed_at: null,
        },
      })
    }
    return route.fulfill({
      json: {
        items: opened
          ? [
              {
                id: 'own-open',
                desk_id: 'front-desk',
                status: 'OPEN',
                business_date: '2026-01-01',
                assigned_operator_id: '00000000-0000-4000-8000-000000000001',
                opened_at: new Date().toISOString(),
                closed_at: null,
              },
            ]
          : [],
      },
    })
  })

  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/tesoreria')

  await expect(page.getByRole('heading', { name: 'Caja' })).toBeVisible()
  const desk = page.getByLabel('Puesto')
  await desk.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Efectivo inicial (pesos)')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Abrir turno' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('status').filter({ hasText: 'Turno abierto.' })).toBeVisible()
  expect(openingRequests).toEqual([{ desk_id: 'front-desk', opening_tenders: { CASH: 0 } }])
  await expect(page.getByLabel('Cerrar turno de caja')).toHaveCount(0)
  await expect(page.getByLabel('Recuperación de turnos vencidos')).toHaveCount(0)
  await expect(page.getByLabel('Turnos cerrados')).toHaveCount(0)
})

test('OPERADOR enters Collections from Caja and records one full selected payment', async ({
  authenticatedPage: page,
}) => {
  let ownShiftOpen = false
  const settlementRequests: unknown[] = []
  const member = {
    id: '00000000-0000-4000-8000-000000000010',
    nombre: 'Ana',
    apellido: 'Gorriti',
    numero_socio: '42',
  }
  const debt = {
    status: 'ready',
    socio_id: member.id,
    currency: 'ARS',
    total_debt_cents: 10_000,
    obligations: [
      {
        id: '00000000-0000-4000-8000-000000000011',
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

  await page.addInitScript(() => {
    const state = JSON.parse(window.localStorage.getItem('athlos.auth')!) as {
      currentUser: { role: string }
    }
    state.currentUser.role = 'OPERADOR'
    window.localStorage.setItem('athlos.auth', JSON.stringify(state))
  })
  await page.route('**/api/v1/socios?*', (route) =>
    route.fulfill({ json: { items: [member], page: 1, limit: 20, total: 1, has_more: false } }),
  )
  await page.route('**/api/v1/dues/debt/*', (route) => route.fulfill({ json: debt }))
  await page.route('**/api/v1/dues/prices?*', (route) => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/v1/padrones/disciplinas*', (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.route('**/api/v1/members/*/condonation-requests*', (route) =>
    route.fulfill({ json: { items: [] } }),
  )
  await page.route('**/api/v1/treasury/shifts', (route) =>
    route.fulfill({
      json: {
        items: ownShiftOpen
          ? [
              {
                id: 'own-open',
                desk_id: 'front-desk',
                status: 'OPEN',
                business_date: '2026-01-01',
                assigned_operator_id: '00000000-0000-4000-8000-000000000001',
                opened_at: new Date().toISOString(),
                closed_at: null,
              },
            ]
          : [],
      },
    }),
  )
  await page.route('**/api/v1/dues/settlements', (route) => {
    settlementRequests.push(JSON.parse(route.request().postData() ?? '{}'))
    return route.fulfill({
      json: {
        settlement_id: 'settlement-1',
        amount_cents: 10_000,
        currency: 'ARS',
        allocations: [],
      },
    })
  })

  await page.goto('/collections')
  await page.getByLabel('Buscar socio').fill('Ana')
  await page.getByRole('button', { name: 'Buscar socio' }).click()
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await expect(
    page.getByText('No podés registrar pagos sin un turno propio abierto y vigente.'),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir a Caja / Tesorería' })).toHaveAttribute(
    'href',
    /\/tesoreria/,
  )
  await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)
  expect(settlementRequests).toEqual([])

  ownShiftOpen = true
  await page.goto('/collections')
  await page.getByLabel('Buscar socio').fill('Ana')
  await page.getByRole('button', { name: 'Buscar socio' }).click()
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await page.getByRole('button', { name: 'Registrar pago' }).click()
  await page.getByRole('button', { name: 'Confirmar pago' }).click()

  await expect(page.getByText(/Pago confirmado\. Operación settlement-1\./)).toBeVisible()
  expect(settlementRequests).toEqual([
    expect.objectContaining({
      obligation_ids: ['00000000-0000-4000-8000-000000000011'],
      shift_id: 'own-open',
      tender: 'CASH',
    }),
  ])
  await expect(page.getByRole('button', { name: /revertir pago/i })).toHaveCount(0)
})

test('OPERADOR reads only own closed Caja history with GET detail', async ({
  authenticatedPage: page,
}) => {
  const detailRequests: string[] = []

  await page.addInitScript(() => {
    const state = JSON.parse(window.localStorage.getItem('athlos.auth')!) as {
      currentUser: { role: string }
    }
    state.currentUser.role = 'OPERADOR'
    window.localStorage.setItem('athlos.auth', JSON.stringify(state))
  })
  await page.route('**/api/v1/treasury/shifts', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'own-closed',
            desk_id: 'front',
            status: 'CLOSED',
            business_date: '2026-01-01',
            assigned_operator_id: '00000000-0000-4000-8000-000000000001',
            opened_at: '2026-01-01T09:00:00Z',
            closed_at: '2026-01-01T20:00:00Z',
          },
          {
            id: 'foreign-closed',
            desk_id: 'back',
            status: 'CLOSED',
            business_date: '2026-01-01',
            assigned_operator_id: '00000000-0000-4000-8000-000000000002',
            opened_at: '2026-01-01T09:00:00Z',
            closed_at: '2026-01-01T20:00:00Z',
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/treasury/shifts/own-closed', (route) => {
    detailRequests.push(route.request().method())
    return route.fulfill({
      json: {
        shift: {
          id: 'own-closed',
          desk_id: 'front',
          status: 'CLOSED',
          business_date: '2026-01-01',
          assigned_operator_id: '00000000-0000-4000-8000-000000000001',
          opened_at: '2026-01-01T09:00:00Z',
          closed_at: '2026-01-01T20:00:00Z',
        },
        close: {
          id: 'close-1',
          shift_id: 'own-closed',
          expected_tenders: { CASH: 2600 },
          counted_tenders: { CASH: 2550 },
          discrepancy: { CASH: -50 },
          reason: 'Control manual',
          closed_at: '2026-01-01T20:00:00Z',
        },
      },
    })
  })

  await page.goto('/tesoreria')

  const history = page.getByRole('region', { name: 'Turnos cerrados' })
  await expect(history.getByRole('button', { name: 'Ver conciliación de front' })).toBeVisible()
  await expect(history.getByText('back')).toHaveCount(0)
  await expect(page.getByLabel('Cerrar turno de caja')).toHaveCount(0)
  await expect(page.getByLabel('Recuperación de turnos vencidos')).toHaveCount(0)
  await history.getByRole('button', { name: 'Ver conciliación de front' }).click()
  await expect(page.getByRole('dialog')).toContainText('Control manual')
  expect(detailRequests).toEqual(['GET'])
})
