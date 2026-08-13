import { expect, test as base, type Page } from '@playwright/test'

type ConsoleErrorGuard = void

const authState = {
  accessToken: 'playwright-test-token',
  refreshToken: 'playwright-test-refresh-token',
  currentUser: {
    operator_id: '00000000-0000-4000-8000-000000000001',
    role: 'ADMIN',
    username: 'playwright.operator',
    permissions: { can_reprint: false, can_anulate: false, data_steward: false },
  },
}

export const test = base.extend<{
  authenticatedPage: Page
  consoleErrorGuard: ConsoleErrorGuard
}>({
  consoleErrorGuard: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })

      await use()

      if (errors.length > 0) {
        throw new Error(`Browser console errors detected:\n${errors.join('\n')}`)
      }
    },
    { auto: true },
  ],
  authenticatedPage: async ({ page }, use) => {
    // Test-only localStorage state; production authentication is never bypassed.
    await page.addInitScript((state) => {
      window.localStorage.setItem('athlos.auth', JSON.stringify(state))
    }, authState)

    await page.route('**/api/v1/club-status*', async (route) => {
      const period = new URL(route.request().url()).searchParams.get('period') ?? 'current-month'
      await route.fulfill({
        json: {
          period,
          generatedAt: '2026-08-12T12:00:00.000Z',
          membership: { active: 128 },
          freshness: [{ domain: 'members', status: 'current', lastImportAt: null }],
          unavailable: [],
          finance: { debits: '1200.00', credits: '950.00', net: '250.00' },
        },
      })
    })
    await page.route('**/api/v1/socios*', (route) =>
      route.fulfill({ json: { activos: 128, suspendidos: 4, baja: 2, total: 134 } }),
    )
    await page.route('**/api/v1/notifications*', (route) =>
      route.fulfill({ json: { items: [], page: 1, limit: 20, total: 0, has_more: false } }),
    )
    await page.route('**/api/v1/notifications/unread-count*', (route) =>
      route.fulfill({ json: { count: 0 } }),
    )
    await page.route('**/api/v1/admin/operations/snapshot*', (route) =>
      route.fulfill({
        json: {
          readiness: { overall: 'ready', db: 'ready', schema: 'ready' },
          freshness: { available: true, items: [] },
          jobs: { available: true, items: [] },
          attention: { available: true, items: [] },
        },
      }),
    )

    await use(page)
  },
})

export { expect }

export async function assertNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }))
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
}

export async function assertInteractiveNames(page: Page) {
  const unnamed = await page.locator('a,button,input,textarea,select').evaluateAll((elements) =>
    elements
      .filter((element) => !element.getAttribute('aria-hidden'))
      .filter(
        (element) =>
          !element.matches('.nodejs-inspector-button') &&
          !element.hasAttribute('data-nextjs-dialog-error-previous') &&
          !element.hasAttribute('data-nextjs-dialog-error-next'),
      )
      .filter((element) => {
        const label = element.getAttribute('aria-label')
        const text = element.textContent?.trim()
        const associated = element.closest('label')?.textContent?.trim()
        return !label && !text && !associated
      })
      .map((element) => element.outerHTML.slice(0, 100)),
  )
  expect(unnamed).toEqual([])
}

export async function assertContained(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const region = page.locator(selector)
    await expect(region).toHaveCount(1)
    const box = await region.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.y).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  }
}

export async function assertNoOverlap(page: Page, selector: string) {
  const overlaps = await page.locator(selector).evaluateAll((elements) => {
    const boxes = elements.map((element) => element.getBoundingClientRect())
    return boxes.flatMap((first, index) =>
      boxes.slice(index + 1).flatMap((second) => {
        const intersects =
          first.left < second.right &&
          first.right > second.left &&
          first.top < second.bottom &&
          first.bottom > second.top
        return intersects ? [{ first: first.toJSON(), second: second.toJSON() }] : []
      }),
    )
  })
  expect(overlaps).toEqual([])
}
