import { expect, test } from '@playwright/test'

/**
 * A finished test must not change when a question in the bank is edited later —
 * otherwise the answer key would not match what pupils have on paper. So the
 * test edits the question after adding it and expects the original wording to
 * stay in the test, with the app admitting it.
 */
const TOPIC_ID = 'csxxOerbvKhz'

test('a question edited after being added does not change the finished test', async ({ page, request }) => {
  const original = 'Kolik plicních laloků má pravá plíce?'
  const edited = 'ZMĚNĚNO: kolik plicních laloků má levá plíce?'

  const created = await request.post('/api/questions', {
    data: {
      topicId: TOPIC_ID,
      question: {
        type: 'short_answer',
        points: 1,
        difficulty: 1,
        payload: { prompt: original, answer: 'tři', acceptedAnswers: [] },
        blocks: [],
      },
    },
  })
  expect(created.ok()).toBeTruthy()
  const { id: questionId } = (await created.json()) as { id: string }

  const test1 = await request.post('/api/tests', {
    data: {
      title: 'Zmrazená písemka',
      description: null,
      graded: true,
      templateId: 'builtin-klasicka',
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      showKey: true,
      items: [{ kind: 'question', questionId, text: null, pointsOverride: null, linesOverride: null }],
    },
  })
  expect(test1.ok()).toBeTruthy()
  const { id: testId } = (await test1.json()) as { id: string }

  // The question changes in the bank only after being added to the test.
  const change = await request.patch('/api/questions', {
    data: {
      id: questionId,
      question: {
        type: 'short_answer',
        points: 1,
        difficulty: 1,
        payload: { prompt: edited, answer: 'dva', acceptedAnswers: [] },
        blocks: [],
      },
    },
  })
  expect(change.ok()).toBeTruthy()

  await page.goto(`/tests/${testId}`)
  // The bank on the left shows the live (i.e. changed) question, so we look only
  // at the test outline — the original wording must stay there.
  const outline = page.locator('ol').first()
  await expect(outline.getByText(original)).toBeVisible()
  await expect(outline.getByText(edited)).toHaveCount(0)
  await expect(outline.getByText('otázka byla od zařazení upravena')).toBeVisible()

  // Clean up so no test material stays in the library.
  await request.delete(`/api/tests?id=${testId}`)
  await request.delete(`/api/questions?id=${questionId}`)
})
