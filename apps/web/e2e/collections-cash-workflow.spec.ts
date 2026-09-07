import {
  allowExpectedResponseFailure,
  assertInteractiveNames,
  assertNoPageOverflow,
  expect,
  test,
} from './fixtures/authenticated-dashboard'
import type { Locator, Page } from '@playwright/test'
import type { CashShift } from '../src/lib/api/treasury'

test('cash round trip preserves selection and reconciles the collected cash', async ({
  authenticatedPage,
}) => {
  await cashJourney(authenticatedPage, false)
})

test('confirmed cash payment survives failed balance refresh without another charge', async ({
  authenticatedPage,
}) => {
  await cashJourney(authenticatedPage, true)
})

async function cashJourney(page: Page, failRefresh: boolean) {
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
  let debtGets = 0
  let failNextDebtRefresh = false
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
      debtGets += 1
      if (failNextDebtRefresh) {
        failNextDebtRefresh = false
        allowExpectedResponseFailure(page, {
          url: request.url(),
          status: 409,
          request: { method, postData: request.postData() },
          context: 'post-settlement debt refresh',
        })
        await route.fulfill({ status: 409, json: { detail: 'Debt refresh conflict' } })
        return
      }
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
      failNextDebtRefresh = failRefresh
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

  const mobileKeyboard = process.env.COLLECTIONS_CASH_MOBILE_KEYBOARD_ENABLED === 'true'
  async function traverseTo(locator: Locator, key = 'Tab') {
    await expect(locator).toBeVisible()
    for (let index = 0; index < 60; index += 1) {
      if (await locator.evaluate((element) => document.activeElement === element)) break
      await page.keyboard.press(key)
    }
    await expect(locator).toBeFocused()
  }
  async function activate(locator: Locator) {
    if (!mobileKeyboard) return locator.click()
    await traverseTo(locator)
    await page.keyboard.press('Enter')
  }
  async function enterValue(locator: Locator, value: string) {
    if (!mobileKeyboard) return locator.fill(value)
    await traverseTo(locator)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText(value)
  }
  async function checkViewport() {
    if (!mobileKeyboard) return
    await assertNoPageOverflow(page)
    await assertInteractiveNames(page)
  }
  if (mobileKeyboard) await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/collections')
  await checkViewport()
  if (mobileKeyboard) {
    const trigger = page.getByRole('button', { name: 'Abrir navegación' })
    await activate(trigger)
    const drawer = page.getByRole('dialog', { name: 'Navegación principal' })
    await traverseTo(drawer.getByRole('link', { name: 'Cobranza', exact: true }))
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await expect(trigger).toBeFocused()
  }
  await enterValue(page.getByRole('searchbox', { name: 'Buscar socio' }), 'Gorriti')
  await activate(page.getByRole('button', { name: 'Buscar socio', exact: true }))
  await activate(page.getByRole('button', { name: /Gorriti, Ana/ }))
  await activate(page.getByRole('button', { name: 'Registrar pago', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'Revisar pago', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Revisar pago', exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox')).toHaveCount(3)
  const february = dialog.getByRole('checkbox', { name: /^Período febrero de 2026:/ })
  if (mobileKeyboard) {
    await traverseTo(february)
    await page.keyboard.press('Space')
  } else await february.uncheck()
  await expect(dialog.getByRole('button', { name: 'Confirmar pago', exact: true })).toBeDisabled()
  await activate(dialog.getByRole('button', { name: 'Ir a caja', exact: true }))
  await expect(page).toHaveURL(/\/tesoreria\?/)
  expect(new URL(page.url()).searchParams.get('cash_obligations')).toBe(firstId)
  await checkViewport()
  await enterValue(page.getByLabel('Puesto', { exact: true }), 'front-desk')
  await enterValue(page.getByLabel('Efectivo inicial (pesos)'), '10,00')
  await activate(page.getByRole('button', { name: 'Abrir turno', exact: true }))
  await expect(page.getByText('Turno abierto.', { exact: true })).toBeVisible()
  await activate(page.getByRole('button', { name: 'Volver a cobranza', exact: true }))
  await expect(page).toHaveURL(/\/collections\?/)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /^Período enero de 2026:/ })).toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: /^Período febrero de 2026:/ }),
  ).not.toBeChecked()
  const cash = dialog.getByRole('radio', { name: 'Efectivo', exact: true })
  const shiftSelect = dialog.getByRole('combobox', { name: 'Turno de caja' })
  if (mobileKeyboard) {
    await traverseTo(shiftSelect)
    await traverseTo(cash, 'Shift+Tab')
    await page.keyboard.press('Space')
    await traverseTo(shiftSelect)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
  } else {
    await cash.check()
    await shiftSelect.selectOption(shiftId)
  }
  await expect(shiftSelect).toHaveValue(shiftId)
  await activate(dialog.getByRole('button', { name: 'Confirmar pago', exact: true }))
  const paymentOutcome = page.getByRole('region', { name: 'Resultado del pago' })
  await expect(paymentOutcome).toContainText(paymentId)
  await expect(paymentOutcome).toContainText(/Importe confirmado:\s*\$\s*100,00/)
  if (failRefresh) {
    await expect(paymentOutcome.getByRole('alert')).toContainText('No se pudo actualizar el saldo.')
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Registrar pago', exact: true }),
    ).not.toBeVisible()
    expect(payments).toBe(1)
    const debtGetsBeforeRecovery = debtGets
    await activate(page.getByRole('button', { name: 'Actualizar saldo', exact: true }))
    await expect(paymentOutcome.getByRole('alert')).not.toBeVisible()
    await expect(paymentOutcome).toContainText(paymentId)
    await expect(paymentOutcome).toContainText(/Importe confirmado:\s*\$\s*100,00/)
    expect(payments).toBe(1)
    expect(debtGets).toBe(debtGetsBeforeRecovery + 1)
  }
  await expect(dialog).not.toBeVisible()
  await activate(page.getByRole('button', { name: 'Registrar pago', exact: true }))
  await expect(dialog.getByRole('checkbox', { name: /^Período febrero de 2026:/ })).toBeChecked()
  await activate(dialog.getByRole('button', { name: 'Cancelar', exact: true }))
  if (mobileKeyboard) {
    await activate(page.getByRole('button', { name: 'Abrir navegación' }))
    const drawer = page.getByRole('dialog', { name: 'Navegación principal' })
    await activate(drawer.getByRole('link', { name: 'Cash desk', exact: true }))
    await expect(drawer).not.toBeVisible()
  } else await page.getByRole('link', { name: 'Cash desk', exact: true }).click()
  await enterValue(page.getByLabel('Efectivo contado (pesos)'), '110,00')
  await activate(page.getByRole('button', { name: /Cerrar front-desk/ }))
  const summary = page.getByRole('region', { name: 'Resumen de conciliación' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText(/\$\s*110,00/)
  await expect(summary).toContainText(/\$\s*0,00/)
  await expect(page.getByRole('region', { name: 'Turnos cerrados' })).toContainText('front-desk')
  await checkViewport()
  expect({ opens, payments, closes }).toEqual({ opens: 1, payments: 1, closes: 1 })
  expect(unexpected).toEqual([])
}
