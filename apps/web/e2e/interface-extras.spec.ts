import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Three UI additions from the redesign spec that the first plan missed:
 * library-wide search, the page estimate below the test outline and the
 * difficulty filter on topic questions.
 */

// The test finds a topic with materials and questions itself — an id hardcoded
// from the author's disk would not exist in another database.

test.describe('library-wide search', () => {
  test('finds a topic across grades and links to it', async ({ page }) => {
    await page.goto('/')

    // In WebKit `fill()` does not trigger React onChange on this field, so the
    // query is typed character by character like the teacher would.
    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    await search.pressSequentially('fotosyntéza')

    const result = page.getByRole('button', { name: /fotosyntéza/i }).first()
    await expect(result).toBeVisible()
    // The path (subject, grade) is visible so it is clear where the topic is from.
    await expect(result).toContainText('PŘÍRODOPIS')

    await result.click()
    await expect(page).toHaveURL(/\/topics\//)
  })

  test('finds a topic by material name too', async ({ page }) => {
    await page.goto('/')

    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    // "Měkkýši" has the material "6.22 Měkkýši (Mollusca)…" — search only by part
    // of the file name, not by the topic name.
    await search.pressSequentially('Mollusca')

    const result = page.getByRole('button', { name: /Měkkýši/i }).first()
    await expect(result).toBeVisible()
    await expect(result).toContainText('soubor')
  })

  test('a short query searches nothing', async ({ page }) => {
    await page.goto('/')
    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    await search.pressSequentially('a')
    await expect(page.getByText('Hledám…')).toHaveCount(0)
  })
})

test.describe('page estimate below the test outline', () => {
  test('appears after adding a question and grows with more', async ({ page }) => {
    // Own topic with two approved questions — relying on "the first expanded
    // topic" in the bank having at least two is fragile: the bank orders topics
    // by subject name and depends on what other tests left there. A question
    // created via the API is approved right away.
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const subject = await page.request.post('/api/library', {
      data: { kind: 'subject', name: `E2E ROZHRANI ${stamp}` },
    })
    expect(subject.ok(), 'could not create the test subject').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }

    try {
      const grade = await page.request.post('/api/library', {
        data: { kind: 'grade', name: `Ročník ${stamp}`, parentId: subjectId },
      })
      expect(grade.ok(), 'could not create the test grade').toBe(true)
      const { id: gradeId } = (await grade.json()) as { id: string }

      const topicName = `Téma pro odhad stran ${stamp}`
      const topic = await page.request.post('/api/library', {
        data: { kind: 'topic', name: topicName, parentId: gradeId },
      })
      expect(topic.ok(), 'could not create the test topic').toBe(true)
      const { id: topicId } = (await topic.json()) as { id: string }

      for (const prompt of ['První otázka na odhad stran', 'Druhá otázka na odhad stran']) {
        const created = await page.request.post('/api/questions', {
          data: {
            topicId,
            question: {
              type: 'short_answer',
              difficulty: 1,
              points: 1,
              blocks: [],
              payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
            },
          },
        })
        expect(created.ok(), 'could not create the test question').toBe(true)
      }

      await page.goto('/tests/new')

      // The own topic is collapsed like all others — find it by its label, not
      // by position, and expand it.
      const topicDetails = page.locator('details').filter({ hasText: topicName })
      await topicDetails.locator('summary').click()
      // Direct children: the question preview contains further option lists.
      const questions = topicDetails.locator('ul > li')
      await expect(questions).toHaveCount(2)

      const firstCheckbox = questions.first().getByRole('checkbox')
      await firstCheckbox.waitFor({ state: 'visible' })
      await firstCheckbox.click()

      // The summary below the outline is a definition list: question count, points, page estimate.
      const summary = page.locator('dl').filter({ hasText: 'Odhad stran:' })
      await expect(summary).toBeVisible()
      await expect(summary).toContainText('Otázek: 1')
      await expect(summary).toContainText('Odhad stran:')

      // With another question the count grows and the estimate stays filled in.
      await questions.nth(1).getByRole('checkbox').click()
      await expect(summary).toContainText('Otázek: 2')
      await expect(summary).toContainText('Odhad stran:')
    } finally {
      await page.request.delete(`/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`)
    }
  })
})

test.describe('difficulty filter on topic questions', () => {
  test('the dropdown opens and selects a value', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))

    // `exact: true`: generation next to it has a similarly named difficulty
    // ("Obtížnost nových otázek") and `getByLabel` would find it too otherwise.
    const difficultyFilter = page.getByLabel('Obtížnost', { exact: true })
    await difficultyFilter.click()
    await page.getByRole('option', { name: 'Těžká' }).click()
    await expect(difficultyFilter).toContainText('Těžká')
  })
})
