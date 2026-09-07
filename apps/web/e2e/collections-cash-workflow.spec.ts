import { expect, test } from './fixtures/authenticated-dashboard'
import type { CashShift } from '../src/lib/api/treasury'

test('cash round trip preserves selection and reconciles the collected cash', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(90_000)
  test.skip(
    process.env.NATIVE_COLLECTIONS_WEB_ENABLED !== 'true' ||
      process.env.DUES_CASH_ENABLED !== 'true',
    'Requires the local Collections and cash feature flags.',
  )
  const memberId = '00000000-0000-4000-8000-000000000010'
  const firstId = '00000000-0000-4000-8000-000000000011'
  const secondId = '00000000-0000-4000-8000-000000000012'
  const shiftId = '00000000-0000-4000-8000-000000000013'
  const paymentId = '00000000-0000-4000-8000-000000000014'
  const member = { id: memberId, nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
  let shift: CashShift | null = null
  let paid = false
  let opens = 0
  let payments = 0
  let closes = 0
  const unexpected: string[] = []

  // Every application API request is mocked or handled by the existing fixture.
  // Unknown requests never reach a real backend, even if an API base URL is configured.
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (
      method === 'GET' &&
      /\/api\/v1\/(club-status|notifications(?:\/unread-count)?|admin\/operations\/snapshot)$/.test(
        path,
      )
    ) {
      await route.fallback()
      return
    }
    if (method === 'GET' && path === `/api/v1/socios/${memberId}`) {
      await route.fulfill({ json: member })
      return
    }
    if (method === 'GET' && path === '/api/v1/socios') {
      await route.fulfill({
        json: { items: [member], page: 1, limit: 20, total: 1, has_more: false },
      })
      return
    }
    if (method === 'GET' && path === `/api/v1/dues/debt/${memberId}`) {
      await route.fulfill({
        json: {
          status: 'ready',
          socio_id: memberId,
          currency: 'ARS',
          total_debt_cents: paid ? 5000 : 15000,
          obligations: [firstId, secondId].map((id, index) => ({
            id,
            period_start: `2026-0${index + 1}-01`,
            period_end: `2026-0${index + 2}-01`,
            original_amount_cents: index ? 5000 : 10000,
            outstanding_cents: index ? 5000 : paid ? 0 : 10000,
            currency: 'ARS',
            status: !index && paid ? 'PAID' : 'OPEN',
            components: [],
            benefits: [],
            allocations: [],
          })),
        },
      })
      return
    }
    if (path === '/api/v1/treasury/shifts') {
      if (method === 'GET') {
        await route.fulfill({ json: { items: shift ? [shift] : [] } })
        return
      }
      if (method === 'POST') {
        opens += 1
        expect(request.postDataJSON()).toEqual({
          desk_id: 'front-desk',
          opening_tenders: { CASH: 1000 },
        })
        expect(request.headers()['idempotency-key']).toBeTruthy()
        shift = {
          id: shiftId,
          desk_id: 'front-desk',
          status: 'OPEN',
          assigned_operator_id: '00000000-0000-4000-8000-000000000001',
          business_date: new Date().toISOString().slice(0, 10),
          opened_at: new Date().toISOString(),
          closed_at: null,
        }
        await route.fulfill({ status: 201, json: shift })
        return
      }
    }
    if (method === 'POST' && path === '/api/v1/dues/settlements') {
      payments += 1
      const body = request.postDataJSON()
      expect(body.socio_id).toBe(memberId)
      expect(body.tender).toBe('CASH')
      expect(JSON.stringify(body)).toContain(firstId)
      expect(JSON.stringify(body)).not.toContain(secondId)
      expect(JSON.stringify(body)).toContain(shiftId)
      expect(request.headers()['idempotency-key']).toBeTruthy()
      paid = true
      await route.fulfill({
        status: 201,
        json: {
          settlement_id: paymentId,
          kind: 'MONETARY',
          amount_cents: 10000,
          currency: 'ARS',
          allocations: [],
        },
      })
      return
    }
    if (method === 'POST' && path === `/api/v1/treasury/shifts/${shiftId}/close`) {
      closes += 1
      expect(paid).toBe(true)
      expect(request.postDataJSON()).toEqual({ counted_tenders: { CASH: 11000 } })
      expect(request.headers()['idempotency-key']).toBeTruthy()
      shift = { ...shift!, status: 'CLOSED', closed_at: new Date().toISOString() }
      await route.fulfill({
        json: {
          id: '00000000-0000-4000-8000-000000000015',
          shift_id: shiftId,
          expected_tenders: { CASH: 11000 },
          counted_tenders: { CASH: 11000 },
          discrepancy: {},
          reason: null,
          closed_at: shift.closed_at,
        },
      })
      return
    }
    if (
      method === 'GET' &&
      (path === '/api/v1/dues/prices' ||
        path === '/api/v1/padrones/disciplinas' ||
        path === `/api/v1/members/${memberId}/condonation-requests`)
    ) {
      await route.fulfill({ json: { items: [] } })
      return
    }
    unexpected.push(`${method} ${path}`)
    await route.fulfill({ json: { items: [] } })
  })

  await page.goto('/collections')
  await page.getByRole('searchbox', { name: 'Buscar socio' }).fill('Gorriti')
  await page.getByRole('button', { name: 'Buscar socio', exact: true }).click()
  await page.getByRole('button', { name: /Gorriti, Ana/ }).click()
  await page.getByRole('button', { name: 'Registrar pago', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Revisar pago', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Revisar pago', exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox')).toHaveCount(3)
  await dialog.getByRole('checkbox', { name: /^Período febrero de 2026:/ }).uncheck()
  await expect(dialog.getByRole('button', { name: 'Confirmar pago', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Ir a caja', exact: true }).click()
  await expect(page).toHaveURL(/\/tesoreria\?/)
  expect(new URL(page.url()).searchParams.get('cash_obligations')).toBe(firstId)
  await page.getByLabel('Puesto', { exact: true }).fill('front-desk')
  await page.getByLabel('Efectivo inicial (pesos)').fill('10,00')
  await page.getByRole('button', { name: 'Abrir turno', exact: true }).click()
  await expect(page.getByText('Turno abierto.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver a cobranza', exact: true }).click()
  await expect(page).toHaveURL(/\/collections\?/)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /^Período enero de 2026:/ })).toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: /^Período febrero de 2026:/ }),
  ).not.toBeChecked()
  await dialog.getByRole('radio', { name: 'Efectivo', exact: true }).check()
  await dialog.getByRole('combobox', { name: 'Turno de caja' }).selectOption(shiftId)
  await dialog.getByRole('button', { name: 'Confirmar pago', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Resultado del pago' })).toContainText(paymentId)
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Registrar pago', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: /^Período febrero de 2026:/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await page.getByRole('link', { name: 'Cash desk', exact: true }).click()
  await page.getByLabel('Efectivo contado (pesos)').fill('110,00')
  await page.getByRole('button', { name: /Cerrar front-desk/ }).click()
  const summary = page.getByRole('region', { name: 'Resumen de conciliación' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText(/\$\s*110,00/)
  await expect(summary).toContainText(/\$\s*0,00/)
  await expect(page.getByRole('region', { name: 'Turnos cerrados' })).toContainText('front-desk')
  expect({ opens, payments, closes }).toEqual({ opens: 1, payments: 1, closes: 1 })
  expect(unexpected).toEqual([])
})
