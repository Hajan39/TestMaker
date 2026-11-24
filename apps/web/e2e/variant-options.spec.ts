import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Variants A and B in the builder: a test with both variants gets an A/B bar
 * above the page with the B options, B is shown read-only from the current
 * draft, and the options are saved with the test.
 */

async function createTest(request: APIRequestContext): Promise<{ id: string; title: string; prompts: string[] }> {
  const bank = await request.get('/api/questions?status=approved&limit=2')
  expect(bank.ok()).toBe(true)
  const { items } = (await bank.json()) as { items: { id: string; payload: { prompt: string } }[] }
  expect(items.length, 'the library needs two approved questions').toBe(2)

  const title = `Kostra ${Date.now().toString(36)}`
  const created = await request.post('/api/tests', {
    data: {
      title,
      templateId: 'builtin-klasicka',
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      items: items.map((item) => ({ kind: 'question', questionId: item.id })),
    },
  })
  expect(created.ok(), 'failed to create the test fixture').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return { id, title, prompts: items.map((item) => item.payload.prompt) }
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Nastavení testu' }).click()
  return page.getByRole('dialog', { name: 'Nastavení testu' })
}

async function chooseBoth(page: Page) {
  const settings = await openSettings(page)
  await settings.getByRole('combobox', { name: 'Varianty' }).click()
  await page.getByRole('option', { name: 'A i B' }).click()
  // The order of B is set next to its preview, not in the settings sheet.
  await expect(settings.getByRole('combobox', { name: 'Pořadí ve variantě B' })).toHaveCount(0)
  await page.keyboard.press('Escape')
}

test('A and B side by side: B follows the chosen order and the options persist', async ({ page, request }) => {
  const { id, title, prompts } = await createTest(request)
  await page.goto(`/tests/${id}`)

  // Only variant A: no tabs, the page carries the plain title.
  await expect(page.getByRole('tab', { name: 'Varianta B' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()

  await chooseBoth(page)
  const tabA = page.getByRole('tab', { name: 'Varianta A' })
  const tabB = page.getByRole('tab', { name: 'Varianta B' })
  await expect(tabA).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: `${title} A`, exact: true })).toBeVisible()

  const order = page.getByRole('combobox', { name: 'Pořadí ve variantě B' })
  const shuffleOptions = page.getByRole('checkbox', { name: 'Přemíchat i možnosti v otázkách' })
  await expect(order).toHaveText('Náhodně')
  await expect(page.getByRole('button', { name: 'Zamíchat znovu' })).toBeEnabled()
  await expect(shuffleOptions).toHaveAttribute('aria-checked', 'true')

  await order.click()
  await page.getByRole('option', { name: 'Opačně' }).click()
  await expect(order).toHaveText('Opačně')
  // "Opačně" has nothing to reshuffle.
  await expect(page.getByRole('button', { name: 'Zamíchat znovu' })).toHaveCount(0)
  await shuffleOptions.click()
  await expect(shuffleOptions).toHaveAttribute('aria-checked', 'false')

  await expect(page.getByRole('tabpanel', { name: 'Varianta A' }).getByTestId('question-prompt')).toHaveText(prompts)
  await tabB.click()
  await expect(tabB).toHaveAttribute('aria-selected', 'true')
  const panelB = page.getByRole('tabpanel', { name: 'Varianta B' })
  await expect(panelB.getByRole('heading', { name: `${title} B`, exact: true })).toBeVisible()
  await expect(panelB.getByTestId('question-prompt')).toHaveText([...prompts].reverse())

  await page.getByRole('button', { name: 'Uložit', exact: true }).click()
  await expect(page.getByTestId('toast-saved')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Varianta B' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Pořadí ve variantě B' })).toHaveText('Opačně')
  await expect(page.getByRole('checkbox', { name: 'Přemíchat i možnosti v otázkách' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  const settings = await openSettings(page)
  await expect(settings.getByRole('combobox', { name: 'Varianty' })).toHaveText('A i B')
  await expect(settings.getByRole('combobox', { name: 'Pořadí ve variantě B' })).toHaveCount(0)

  await request.delete(`/api/tests?id=${id}`)
})

test('an unsaved test explains that B appears after the first save', async ({ page }) => {
  await page.goto('/tests/new')
  await chooseBoth(page)
  await page.getByRole('tab', { name: 'Varianta B' }).click()
  await expect(page.getByTestId('variant-b-unsaved')).toHaveText('Variantu B uvidíš po prvním uložení.')
})
