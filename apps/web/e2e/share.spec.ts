import { expect, test } from '@playwright/test'

/**
 * Time-limited print link: the author copies it from the print menu and
 * anyone opens it without an account. Runs only in the sign-in config
 * (`playwright.login.config.ts`) — the link is signed with `AUTH_SECRET`
 * and the anonymous visitor is the point of the test. That server has no
 * Brevo key, so the e-mail button is replaced by a hint.
 *
 *   cd apps/web && pnpm exec playwright test -c playwright.login.config.ts share.spec.ts
 */

const TITLE = `Odkaz na tisk ${Date.now()}`

test('the author copies a print link and a stranger prints the pupil version', async ({ browser, baseURL }) => {
  const author = await browser.newContext({
    storageState: 'e2e/.auth/ucitelkaA.json',
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const stranger = await browser.newContext({ baseURL })

  try {
    const created = await author.request.post('/api/tests', {
      data: {
        title: TITLE,
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 2,
        showKey: true,
        items: [],
      },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }

    const page = await author.newPage()
    await page.goto(`/tests/${id}`)
    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    await page.getByRole('menuitem', { name: 'Odkaz na tisk (7 dní)' }).click()

    const dialog = page.getByRole('dialog', { name: 'Odkaz na tisk' })
    const field = dialog.getByLabel('Odkaz na tisk')
    await expect(field).toHaveValue(/\/tisk\/[\w-]+\.[0-9a-f]{64}$/)
    const url = await field.inputValue()
    await expect(dialog.getByTestId('share-valid-until')).toHaveText(/^Platí do \d+\. \d+\. \d{4} \d+:\d{2}\.$/)

    await dialog.getByRole('button', { name: 'Kopírovat' }).click()
    await expect(page.getByTestId('toast-share-copied')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)

    // No Brevo key on this server: no button, a hint instead.
    await expect(dialog.getByRole('button', { name: 'Poslat mi odkaz e-mailem' })).toHaveCount(0)
    await expect(dialog.getByTestId('share-email-hint')).toBeVisible()

    // A stranger without an account: the test, no app bar, both variants.
    const visitor = await stranger.newPage()
    await visitor.goto(url)
    await expect(visitor.getByRole('heading', { name: TITLE })).toBeVisible()
    await expect(visitor.getByRole('link', { name: 'Ročníky' })).toHaveCount(0)
    await expect(visitor.getByRole('button', { name: 'Stáhnout PDF, varianta B' })).toBeEnabled()

    const pdf = visitor.waitForResponse((response) => response.url().includes('/api/tisk/'), { timeout: 60_000 })
    await visitor.getByRole('button', { name: 'Vytisknout, varianta A' }).click()
    const response = await pdf
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/pdf')
    expect(decodeURIComponent(response.headers()['content-disposition'] ?? '')).toContain(`${TITLE} A.pdf`)

    // Asking for the solutions changes nothing — still the pupil file.
    const sneaky = await stranger.request.get(`${url.replace('/tisk/', '/api/tisk/')}?varianta=B&key=1&filled=1`)
    expect(sneaky.status()).toBe(200)
    expect(decodeURIComponent(sneaky.headers()['content-disposition'] ?? '')).toContain(`${TITLE} B.pdf`)

    // A broken link explains itself instead of a blank page.
    await visitor.goto('/tisk/neplatny.odkaz')
    await expect(visitor.getByTestId('share-expired')).toBeVisible()
  } finally {
    await author.close()
    await stranger.close()
  }
})
