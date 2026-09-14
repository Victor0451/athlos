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
