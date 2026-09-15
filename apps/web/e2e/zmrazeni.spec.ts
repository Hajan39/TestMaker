import { expect, test } from '@playwright/test'

/**
 * Hotová písemka se nesmí změnit tím, že se otázka v bance později upraví —
 * jinak by klíč k odpovědím neseděl s tím, co mají žáci na papíře. Test proto
 * otázku po zařazení do testu upraví a čeká, že v testu zůstane původní znění
 * a že to aplikace přizná.
 */
const TOPIC_ID = 'csxxOerbvKhz'

test('otázka upravená po zařazení nezmění hotový test', async ({ page, request }) => {
  const puvodni = 'Kolik plicních laloků má pravá plíce?'
  const upravene = 'ZMĚNĚNO: kolik plicních laloků má levá plíce?'

  const vytvorena = await request.post('/api/questions', {
    data: {
      topicId: TOPIC_ID,
      question: {
        type: 'short_answer',
        points: 1,
        difficulty: 1,
        payload: { prompt: puvodni, answer: 'tři', acceptedAnswers: [] },
        blocks: [],
      },
    },
  })
  expect(vytvorena.ok()).toBeTruthy()
  const { id: questionId } = (await vytvorena.json()) as { id: string }

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

  // Otázka se v bance změní až po zařazení do testu.
  const zmena = await request.patch('/api/questions', {
    data: {
      id: questionId,
      question: {
        type: 'short_answer',
        points: 1,
        difficulty: 1,
        payload: { prompt: upravene, answer: 'dva', acceptedAnswers: [] },
        blocks: [],
      },
    },
  })
  expect(zmena.ok()).toBeTruthy()

  await page.goto(`/tests/${testId}`)
  // Banka vlevo ukazuje živou (tedy změněnou) otázku, proto se díváme jen do
  // osnovy testu — tam musí zůstat původní znění.
  const osnova = page.locator('ol').first()
  await expect(osnova.getByText(puvodni)).toBeVisible()
  await expect(osnova.getByText(upravene)).toHaveCount(0)
  await expect(osnova.getByText('otázka byla od zařazení upravena')).toBeVisible()

  // Uklidíme po sobě, ať v knihovně nezůstává zkušební materiál.
  await request.delete(`/api/tests?id=${testId}`)
  await request.delete(`/api/questions?id=${questionId}`)
})
