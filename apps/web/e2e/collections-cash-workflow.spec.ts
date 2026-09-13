import {
  allowExpectedResponseFailure,
  assertInteractiveNames,
  assertNoPageOverflow,
  expect,
  test,
} from './fixtures/authenticated-dashboard'
import type { Locator, Page, Route } from '@playwright/test'
import type { CashClose, CashShift } from '../src/lib/api/treasury'

const qaMode = process.env.ATHLOS_CASH_QA_MODE
if (qaMode !== undefined && qaMode !== 'manual' && qaMode !== 'smoke')
  throw new Error('ATHLOS_CASH_QA_MODE must be unset, manual, or smoke')
let qaRole: 'ADMIN' | 'TESORERO' = 'ADMIN'
if (qaMode !== undefined) {
  const role = process.env.ATHLOS_CASH_QA_ROLE
  if (role !== 'ADMIN' && role !== 'TESORERO')
    throw new Error('ATHLOS_CASH_QA_ROLE must be ADMIN or TESORERO')
  qaRole = role
}
if (qaMode === 'manual' && process.env.CI) throw new Error('Manual cash QA cannot run in CI')
test.use({ operatorRole: qaRole, serviceWorkers: 'block' })
const scenarioTitle =
  qaMode === 'manual'
    ? 'manual session: record human cash acceptance separately'
    : qaMode === 'smoke'
      ? 'cash smoke: simulated QA fixture, not human acceptance'
      : 'cash round trip preserves selection and reconciles the collected cash'

test(scenarioTitle, async ({ authenticatedPage }) => {
  await cashJourney(authenticatedPage, false)
})

test('confirmed cash payment survives failed balance refresh without another charge', async ({
  authenticatedPage,
}) => {
  await cashJourney(authenticatedPage, true)
})

async function cashJourney(page: Page, failRefresh: boolean) {
  test.setTimeout(qaMode === 'manual' ? 30 * 60_000 : 90_000)
  test.skip(
    qaMode === 'manual' && failRefresh,
    'Recovery automation is separate from human acceptance',
  )
  if (qaMode === 'manual' && test.info().project.use.headless !== false)
    throw new Error('Manual cash QA requires --headed')
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
  const foreignShift: CashShift = {
    id: '00000000-0000-4000-8000-000000000016',
    desk_id: 'foreign-history-desk',
    status: 'CLOSED',
    assigned_operator_id: '00000000-0000-4000-8000-000000000002',
    business_date: '2026-01-31',
    opened_at: '2026-01-31T08:00:00Z',
    closed_at: '2026-01-31T17:00:00Z',
  }
  const foreignClose: CashClose = {
    id: '00000000-0000-4000-8000-000000000017',
    shift_id: foreignShift.id,
    expected_tenders: { CASH: 2600 },
    counted_tenders: { CASH: 2550 },
    discrepancy: { CASH: -50 },
    reason: 'Faltante registrado en el turno de prueba.',
    closed_at: foreignShift.closed_at!,
  }
  let shift: CashShift | null = null
  let paid = false
  let opens = 0
  let payments = 0
  let closes = 0
  let historicalGets = 0
  let savedClose: CashClose | null = null
  let debtGets = 0
  let failNextDebtRefresh = false
  const unexpected: string[] = []
  async function setQaFeedback(message: string) {
    await page.evaluate((text) => {
      let feedback = document.querySelector<HTMLElement>('[data-testid="cash-qa-feedback"]')
      if (!feedback) {
        feedback = document.createElement('p')
        feedback.setAttribute('role', 'alert')
        feedback.setAttribute('data-testid', 'cash-qa-feedback')
        feedback.style.cssText =
          'box-sizing:border-box;max-width:100%;margin:0;padding:8px;background:#fff3cd;color:#332701;font:14px/1.4 sans-serif;overflow-wrap:anywhere;'
        document.body.prepend(feedback)
      }
      feedback.textContent = text
      feedback.hidden = !text
    }, message)
  }
  async function rejectQaScenario(route: Route, message: string) {
    const request = route.request()
    allowExpectedResponseFailure(page, {
      url: request.url(),
      status: 400,
      request: { method: request.method(), postData: request.postData() },
      context: 'cash QA scenario correction',
    })
    await setQaFeedback(message)
    await route.fulfill({
      status: 400,
      json: { error: 'VALIDATION_ERROR', message, request_id: 'cash-qa-fixture' },
    })
  }

  if (qaMode) {
    const localOrigin = new URL(test.info().project.use.baseURL!).origin
    await page.context().route('**/*', (route) => {
      const url = new URL(route.request().url())
      return url.origin === localOrigin && !url.pathname.startsWith('/api/')
        ? route.continue()
        : route.abort('blockedbyclient')
    })
  }

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
    if (method === 'GET' && path === `/api/v1/treasury/shifts/${shiftId}`) {
      historicalGets += 1
      expect(savedClose).not.toBeNull()
      await route.fulfill({ json: { shift, close: savedClose } })
      return
    }
    if (qaMode && method === 'GET' && path === `/api/v1/treasury/shifts/${foreignShift.id}`) {
      await route.fulfill({ json: { shift: foreignShift, close: foreignClose } })
      return
    }
    if (path === '/api/v1/treasury/shifts') {
      if (method === 'GET') {
        await route.fulfill({
          json: { items: [...(shift ? [shift] : []), ...(qaMode ? [foreignShift] : [])] },
        })
        return
      }
      if (method === 'POST') {
        const body = request.postDataJSON()
        if (
          qaMode &&
          (shift !== null ||
            body.desk_id !== 'front-desk' ||
            body.opening_tenders?.CASH !== 1000 ||
            Object.keys(body.opening_tenders ?? {}).length !== 1 ||
            Object.keys(body).length !== 2)
        ) {
          await rejectQaScenario(
            route,
            'Simulador de prueba: abrí un único turno front-desk con efectivo inicial $10,00. Los $100,00 corresponden al pago, no a la apertura.',
          )
          return
        }
        if (qaMode) await setQaFeedback('')
        opens += 1
        expect(body).toEqual({
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
      const body = request.postDataJSON()
      if (
        qaMode &&
        (paid ||
          shift?.status !== 'OPEN' ||
          body.socio_id !== memberId ||
          body.tender !== 'CASH' ||
          body.shift_id !== shiftId ||
          !Array.isArray(body.obligation_ids) ||
          body.obligation_ids.length !== 1 ||
          body.obligation_ids[0] !== firstId)
      ) {
        await rejectQaScenario(
          route,
          'Simulador de prueba: cobrá solo enero por $100,00 en efectivo con el turno front-desk abierto. Desmarcá febrero; este escenario admite un solo pago.',
        )
        return
      }
      if (qaMode) await setQaFeedback('')
      payments += 1
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
      const body = request.postDataJSON()
      if (
        qaMode &&
        (shift?.status !== 'OPEN' ||
          !paid ||
          body.counted_tenders?.CASH !== 11000 ||
          Object.keys(body.counted_tenders ?? {}).length !== 1 ||
          Object.keys(body).length !== 1)
      ) {
        await rejectQaScenario(
          route,
          'Simulador de prueba: después del pago de $100,00, cerrá el turno con efectivo contado $110,00 y sin motivo de diferencia.',
        )
        return
      }
      if (qaMode) await setQaFeedback('')
      closes += 1
      expect(paid).toBe(true)
      expect(body).toEqual({ counted_tenders: { CASH: 11000 } })
      expect(request.headers()['idempotency-key']).toBeTruthy()
      shift = { ...shift!, status: 'CLOSED', closed_at: new Date().toISOString() }
      savedClose = {
        id: '00000000-0000-4000-8000-000000000015',
        shift_id: shiftId,
        expected_tenders: { CASH: 11000 },
        counted_tenders: { CASH: 11000 },
        discrepancy: {},
        reason: null,
        closed_at: shift.closed_at!,
      }
      await route.fulfill({ json: savedClose })
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
  if (qaMode) {
    await expect(page.getByLabel('Buscar socio', { exact: true })).toBeVisible()
    await setQaFeedback(
      'Simulador de prueba: apertura front-desk $10,00; pago solo enero $100,00; cierre $110,00. Estos importes son del escenario de prueba, no reglas de Caja.',
    )
  }
  if (qaMode === 'manual') {
    await expect(page.getByLabel('Buscar socio', { exact: true })).toBeVisible()
    process.stdout.write(
      `CASH_QA_READY role=${qaRole} api=simulated; human acceptance is not an automated verdict\n`,
    )
    await page.pause()
    expect(unexpected).toEqual([])
    test.skip(true, 'Session ended; human acceptance must be recorded separately')
    return
  }
  if (qaMode === 'smoke') await page.reload()
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
  const cashNavigation = dialog.getByRole('button', { name: 'Ir a caja', exact: true })
  await expect(dialog.locator(':focus')).toHaveCount(1)
  if (mobileKeyboard) {
    await traverseTo(cashNavigation)
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(cashNavigation).toBeFocused()
  }
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
  const qaFeedback = page.getByTestId('cash-qa-feedback')
  async function expectQa400(path: string, command: () => Promise<void>, message: RegExp) {
    await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === path &&
          response.request().method() === 'POST' &&
          response.status() === 400,
      ),
      command(),
    ])
    await expect(qaFeedback).toContainText(message)
    expect(page.isClosed()).toBe(false)
  }
  await enterValue(page.getByLabel('Puesto', { exact: true }), 'front-desk')
  if (qaMode === 'smoke') {
    await enterValue(page.getByLabel('Efectivo inicial (pesos)'), '100,00')
    const open = page.getByRole('button', { name: 'Abrir turno', exact: true })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(open).toBeEnabled()
      await expectQa400(
        '/api/v1/treasury/shifts',
        () => activate(open),
        /Simulador de prueba:.*\$10,00/,
      )
    }
    expect(opens).toBe(0)
  }
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
  if (qaMode === 'smoke') {
    await february.check()
    await expectQa400(
      '/api/v1/dues/settlements',
      () => activate(dialog.getByRole('button', { name: 'Confirmar pago', exact: true })),
      /Simulador de prueba:.*enero.*\$100,00/,
    )
    expect(payments).toBe(0)
    await expect(dialog).toBeVisible()
    await february.uncheck()
  }
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
  await expect(dialog.locator(':focus')).toHaveCount(1)
  if (mobileKeyboard) {
    await traverseTo(cashNavigation)
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Confirmar pago', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(cashNavigation).toBeFocused()
  }
  await activate(dialog.getByRole('button', { name: 'Cancelar', exact: true }))
  await expect(page.getByRole('button', { name: 'Registrar pago', exact: true })).toBeFocused()
  if (mobileKeyboard) {
    await activate(page.getByRole('button', { name: 'Abrir navegación' }))
    const drawer = page.getByRole('dialog', { name: 'Navegación principal' })
    await activate(drawer.getByRole('link', { name: 'Cash desk', exact: true }))
    await expect(drawer).not.toBeVisible()
  } else await page.getByRole('link', { name: 'Cash desk', exact: true }).click()
  if (qaMode === 'smoke') {
    await enterValue(page.getByLabel('Efectivo contado (pesos)'), '100,00')
    const close = page.getByRole('button', { name: /Cerrar front-desk/ })
    await expect(close).toBeEnabled()
    await expectQa400(
      `/api/v1/treasury/shifts/${shiftId}/close`,
      () => activate(close),
      /Simulador de prueba:.*\$110,00/,
    )
    expect(closes).toBe(0)
  }
  await enterValue(page.getByLabel('Efectivo contado (pesos)'), '110,00')
  await activate(page.getByRole('button', { name: /Cerrar front-desk/ }))
  const summary = page.getByRole('region', { name: 'Resumen de conciliación' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText(/\$\s*110,00/)
  await expect(summary).toContainText(/\$\s*0,00/)
  await expect(page.getByRole('region', { name: 'Turnos cerrados' })).toContainText('front-desk')
  await checkViewport()
  await page.reload()
  await expect(summary).not.toBeVisible()
  const historyOpener = page.getByRole('button', {
    name: 'Ver conciliación de front-desk',
    exact: true,
  })
  await expect(historyOpener).toBeVisible()
  expect(historicalGets).toBe(0)
  await activate(historyOpener)
  const historyDetail = page.getByRole('dialog', {
    name: 'Conciliación del turno front-desk',
    exact: true,
  })
  await expect(historyDetail).toContainText(/\$\s*110,00/)
  await expect(historyDetail).toContainText(/\$\s*0,00/)
  expect(historicalGets).toBe(1)
  await checkViewport()
  await activate(historyDetail.getByRole('button', { name: 'Cerrar detalle', exact: true }))
  await expect(historyDetail).not.toBeVisible()
  await expect(historyOpener).toBeFocused()
  if (qaMode === 'smoke') {
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('athlos.auth')!).currentUser.role),
    ).toBe(qaRole)
    const foreignOpener = page.getByRole('button', {
      name: 'Ver conciliación de foreign-history-desk',
      exact: true,
    })
    await activate(foreignOpener)
    const foreignDetail = page.getByRole('dialog', {
      name: 'Conciliación del turno foreign-history-desk',
      exact: true,
    })
    await expect(foreignDetail).toContainText(/\$\s*26,00/)
    await expect(foreignDetail).toContainText(/\$\s*25,50/)
    await expect(foreignDetail).toContainText(/-\$\s*0,50/)
    await activate(foreignDetail.getByRole('button', { name: 'Cerrar detalle', exact: true }))
    await expect(foreignOpener).toBeFocused()
  }
  expect({ opens, payments, closes }).toEqual({ opens: 1, payments: 1, closes: 1 })
  expect(unexpected).toEqual([])
}
