import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Changing the question type in the editor keeps what the teacher already
 * wrote — nothing is saved, the form is only filled and switched.
 */
test('the prompt survives a change of question type and switching back', async ({ page }) => {
  const prompt = 'Popiš, jak vzniká duha.'
  await page.goto(await testTopicPath(page.request))
  await page.getByRole('button', { name: 'Nová otázka' }).click()
  const form = page.getByTestId('new-question-form')

  await form.getByLabel('Typ').click()
  await page.getByRole('option', { name: 'Volná odpověď' }).click()
  await form.getByLabel('Zadání').fill(prompt)

  await form.getByLabel('Typ').click()
  await page.getByRole('option', { name: 'Krátká odpověď' }).click()
  await expect(form.getByLabel('Typ')).toHaveText('Krátká odpověď')
  await expect(form.getByLabel('Zadání')).toHaveValue(prompt)

  await form.getByLabel('Typ').click()
  await page.getByRole('option', { name: 'Volná odpověď' }).click()
  await expect(form.getByLabel('Zadání')).toHaveValue(prompt)
})
