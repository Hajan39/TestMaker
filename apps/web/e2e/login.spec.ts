import { expect, test } from '@playwright/test'
import { PASSWORD, ACCOUNTS } from '../playwright.login.config'

/**
 * Account sign-in and sign-out. Runs only against the server with accounts
 * enabled, started by `playwright.login.config.ts` on port 3101. In the shared
 * run (`playwright.config.ts`, port 3100, server without sign-in) the test
 * would have nothing to check, so it is skipped there.
 */
test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Run via: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('a signed-out user is let only onto the login page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
  // The login page has no app navigation.
  await expect(page.getByRole('link', { name: 'Třídy' })).toHaveCount(0)
})

test('a wrong password shows a message and lets nowhere in', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(ACCOUNTS.ucitelkaA)
  await page.getByLabel('Heslo').fill('uplne-jine-heslo')
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page.getByTestId('login-error')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('signs in with the correct password, survives a reload and signs out', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(ACCOUNTS.ucitelkaA)
  await page.getByLabel('Heslo').fill(PASSWORD)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Třídy' })).toBeVisible()

  // The cookie holds after a page reload.
  await page.reload()
  await expect(page).toHaveURL(/\/$/)

  // The bar shows who is signed in — several people take turns at one
  // staff-room computer.
  await page.getByRole('button', { name: /Učitelka A/ }).click()
  await page.getByRole('menuitem', { name: 'Odhlásit se' }).click()
  await expect(page).toHaveURL(/\/login/)

  // After signing out, no way back in.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('returns to where the user was heading after sign-in', async ({ page }) => {
  await page.goto('/tests')
  await expect(page).toHaveURL(/\/login\?dal=/)

  await page.getByLabel('E-mail').fill(ACCOUNTS.ucitelkaA)
  await page.getByLabel('Heslo').fill(PASSWORD)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/tests$/)
})

test('the remembered class is per user, not per browser — the next person signing in does not inherit it', async ({
  page,
}) => {
  // A shared staff-room computer: one teacher signs out, another signs in
  // in the same browser (same `localStorage`). The remembered-class key must
  // therefore include the identity, otherwise the second would be redirected
  // straight to a class she never opened.
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(ACCOUNTS.ucitelkaA)
  await page.getByLabel('Heslo').fill(PASSWORD)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page).toHaveURL(/\/$/)

  const subjectName = `E2E SDILENY POCITAC ${Date.now()}`
  const subject = await page.request.post('/api/library', { data: { kind: 'subject', name: subjectName } })
  expect(subject.ok(), 'failed to create the test subject').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }
  const gradeName = `Třída učitelky A ${Date.now()}`
  const grade = await page.request.post('/api/library', {
    data: { kind: 'grade', name: gradeName, parentId: subjectId },
  })
  expect(grade.ok(), 'failed to create the test grade').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  // Visiting the class remembers `gradeId` under teacher A's key.
  await page.goto(`/tridy/${gradeId}`)
  await expect(page.getByRole('heading', { name: gradeName, exact: true })).toBeVisible()

  // Sign out and sign in as teacher B — without changing the browser (and
  // thus without changing `localStorage`).
  await page.getByRole('button', { name: /Učitelka A/ }).click()
  await page.getByRole('menuitem', { name: 'Odhlásit se' }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel('E-mail').fill(ACCOUNTS.ucitelkaB)
  await page.getByLabel('Heslo').fill(PASSWORD)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page).toHaveURL(/\/$/)

  // Teacher B must not end up on the class teacher A opened — the library is
  // shared, so both see the class tile itself; but she must not be redirected
  // straight inside without her own click.
  await expect(page).toHaveURL('/')
  await expect(page).not.toHaveURL(`/tridy/${gradeId}`)
})
