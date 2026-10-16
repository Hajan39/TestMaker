import { expect, test, type Page } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * "Doplnit odpovědi" in the question editor. The model is not called — the
 * `/api/questions/complete` response is faked (`page.route`); the test checks
 * what the form shows and what the UI sends in each step.
 */

const PROMPT = 'Jaký plyn rostliny přijímají při fotosyntéze?'

const filled = (fromMaterials: boolean) => ({
  status: 'filled',
  fromMaterials,
  question: {
    type: 'short_answer',
    points: 1,
    difficulty: 2,
    blocks: [],
    payload: { prompt: PROMPT, answer: 'oxid uhličitý', acceptedAnswers: ['CO₂', 'CO2'] },
  },
})

/** Fakes the route with the given answers in turn and returns the request bodies that arrived. */
async function mockComplete(page: Page, responses: unknown[]): Promise<Record<string, unknown>[]> {
  const requests: Record<string, unknown>[] = []
  await page.route('**/api/questions/regenerate', (route) => route.fulfill({ json: { configured: true } }))
  await page.route('**/api/questions/complete', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ json: responses[requests.length - 1] })
  })
  return requests
}

async function openShortAnswerForm(page: Page) {
  await page.goto(await testTopicPath(page.request))
  await page.getByRole('button', { name: 'Nová otázka' }).click()
  const form = page.getByTestId('new-question-form')
  await form.getByLabel('Typ').click()
  await page.getByRole('option', { name: 'Krátká odpověď' }).click()
  await form.getByLabel('Zadání').fill(PROMPT)
  return form
}

test('fills the answer and accepted answers from the materials', async ({ page }) => {
  const requests = await mockComplete(page, [filled(true)])
  const form = await openShortAnswerForm(page)

  await form.getByRole('button', { name: 'Doplnit odpovědi' }).click()

  await expect(form.getByLabel('Správná odpověď')).toHaveValue('oxid uhličitý')
  await expect(form.getByLabel('Další uznávané odpovědi')).toHaveValue('CO₂; CO2')
  await expect(form.getByLabel('Zadání')).toHaveValue(PROMPT)
  await expect(form.getByTestId('complete-answers-warning')).toHaveCount(0)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ allowGeneralKnowledge: false, question: { type: 'short_answer', payload: { prompt: PROMPT } } })
})

test('not in the materials asks first and fills only after confirming', async ({ page }) => {
  const requests = await mockComplete(page, [{ status: 'not_found', reason: 'Materiály o plynech nemluví.' }, filled(false)])
  const form = await openShortAnswerForm(page)

  await form.getByRole('button', { name: 'Doplnit odpovědi' }).click()

  const notFound = form.getByTestId('complete-answers-not-found')
  await expect(notFound).toContainText('V materiálech tématu odpověď není.')
  await expect(notFound).toContainText('Materiály o plynech nemluví.')
  await expect(form.getByLabel('Správná odpověď')).toHaveValue('')

  await notFound.getByRole('button', { name: 'Doplnit z obecných znalostí' }).click()

  await expect(form.getByLabel('Správná odpověď')).toHaveValue('oxid uhličitý')
  await expect(form.getByTestId('complete-answers-warning')).toHaveText('Odpověď nevychází z materiálů tématu — zkontroluj ji.')
  await expect(notFound).toHaveCount(0)
  expect(requests.map((body) => body.allowGeneralKnowledge)).toEqual([false, true])
})
