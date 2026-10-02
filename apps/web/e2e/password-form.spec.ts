import { expect, test } from '@playwright/test'

/** The password form checks itself before sending anything: the repeat must match. */
test('a new password that does not match its repeat is not sent', async ({ page }) => {
  let sent = false
  await page.route('**/api/zmena-hesla', (route) => {
    sent = true
    return route.abort()
  })
  await page.goto('/zmena-hesla')
  // In Safari a fill can arrive before hydration and get lost — repeat until the form takes it.
  const save = page.getByRole('button', { name: 'Uložit heslo' })
  await expect
    .poll(async () => {
      await page.getByLabel('Nové heslo', { exact: true }).fill('nove-heslo-1')
      return save.isEnabled()
    })
    .toBe(true)
  await page.getByLabel('Nové heslo znovu').fill('nove-heslo-2')
  await save.click()
  // The message is located by its test id, not its wording — rewording it must not break the test.
  await expect(page.getByTestId('password-error')).toBeVisible()
  expect(sent).toBe(false)
})
