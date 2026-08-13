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

    await expect(page.getByRole('heading', { name: /Athlos keeps/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Operator login' })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Implementation inquiry form' })).toBeVisible()
    await expect(page.getByLabel('Name', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Email', { exact: false })).toBeVisible()
    await expect(page.getByText(/does not persist inquiry content/)).toBeVisible()

    await assertNoPageOverflow(page)
    await assertInteractiveNames(page)
    await assertContained(page, ['main', 'header', '#implementation-contact'])
    await assertNoOverlap(page, 'main > div > section, main > div > #implementation-contact')

    const login = page.getByRole('link', { name: 'Operator login' })
    await login.focus()
    await expect(login).toBeFocused()
  })
}
