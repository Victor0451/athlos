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
  test(`landing is contained and operable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /operación de club/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Acceso de operadores' })).toBeVisible()
    await expect(
      page.getByRole('form', { name: 'Formulario de consulta de implementación' }),
    ).toBeVisible()
    await expect(page.getByLabel('Nombre', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Correo electrónico', { exact: false })).toBeVisible()
    await expect(page.getByText(/no conserva el contenido de la consulta/)).toBeVisible()

    await assertNoPageOverflow(page)
    await assertInteractiveNames(page)
    await assertContained(page, ['main', 'header', '#implementation-contact'])
    await assertNoOverlap(page, 'main > div > section, #implementation-contact')

    const login = page.getByRole('link', { name: 'Acceso de operadores' })
    await login.focus()
    await expect(login).toBeFocused()
  })
}
