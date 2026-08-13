import {
  assertContained,
  assertInteractiveNames,
  assertNoPageOverflow,
  assertNoOverlap,
  expect,
  test,
} from './fixtures/authenticated-dashboard'

const viewports = [320, 768, 1024, 1440]

for (const width of viewports) {
  test(`dashboard is contained at ${width}px`, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { name: 'Estado del club' })).toBeVisible()
    const period = page.getByLabel('Período financiero')
    await expect(period).toHaveValue('current-month')
    await period.selectOption('last-90-days')
    await expect(period).toHaveValue('last-90-days')
    await expect(page.getByText('Actualizado')).toBeVisible()
    await expect(page.getByText('No hay notificaciones pendientes.')).toBeVisible()

    await assertNoPageOverflow(page)
    await assertInteractiveNames(page)
    await assertContained(page, [
      '[data-testid="appshell-content"]',
      '[data-testid="club-status-dashboard"]',
    ])
    await assertNoOverlap(page, '[data-testid="club-status-dashboard"] article')
    await period.focus()
    await expect(period).toBeFocused()
  })
}

test('mobile drawer traps focus and restores it to the trigger', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/dashboard')

  const trigger = page.getByRole('button', { name: 'Abrir navegación' })
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: 'Navegación principal' })
  const close = drawer.getByRole('button', { name: 'Cerrar navegación' })
  await expect(drawer).toBeVisible()
  await expect(close).toBeFocused()

  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})
