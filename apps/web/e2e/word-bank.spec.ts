import { expect, test } from '@playwright/test'

/**
 * A fill-in-the-blank question may come with words on offer. Whether pupils
 * get them depends on the test, so the builder can switch the offer off for
 * one question — the bank question keeps its words.
 */
const TOPIC_ID = 'csxxOerbvKhz'

test('the word bank of a fill-in-the-blank question can be left out of a test', async ({ page, request }) => {
  const stamp = Date.now()
  const created = await request.post('/api/questions', {
    data: {
      topicId: TOPIC_ID,
      question: {
        type: 'fill_blank',
        points: 2,
        difficulty: 1,
        blocks: [],
        payload: {
          prompt: `Doplň chybějící slova ${stamp}.`,
          text: 'Vzduch vstupuje do těla ___ a pokračuje do ___.',
          blanks: ['nosem', 'hrtanu'],
          wordBank: ['nosem', 'hrtanu', `žaludkem${stamp}`],
        },
      },
    },
  })
  expect(created.ok()).toBeTruthy()
  const { id: questionId } = (await created.json()) as { id: string }
  const saved = await request.post('/api/tests', {
    data: {
      title: `Nabídka slov ${stamp}`,
      templateId: 'builtin-klasicka',
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      items: [{ kind: 'question', questionId, text: null, pointsOverride: null, linesOverride: null }],
    },
  })
  expect(saved.ok()).toBeTruthy()
  const { id: testId } = (await saved.json()) as { id: string }

  try {
    await page.goto(`/tests/${testId}`)
    const sheet = page.locator('[data-slot="paper-sheet"]')
    await expect(sheet.getByText(`žaludkem${stamp}`)).toBeVisible()

    const row = sheet.locator('ol > li', { hasText: `Doplň chybějící slova ${stamp}` })
    await row.hover()
    await row.getByRole('checkbox', { name: 'Nabídka slov' }).click()
    await expect(sheet.getByText(`žaludkem${stamp}`)).toHaveCount(0)

    await page.getByRole('button', { name: 'Uložit', exact: true }).click()
    await expect(page.getByTestId('toast-saved')).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-slot="paper-sheet"]').getByText(`Doplň chybějící slova ${stamp}`)).toBeVisible()
    await expect(page.locator('[data-slot="paper-sheet"]').getByText(`žaludkem${stamp}`)).toHaveCount(0)
  } finally {
    await request.delete(`/api/tests?id=${testId}`)
    await request.delete(`/api/questions?id=${questionId}`)
  }
})
