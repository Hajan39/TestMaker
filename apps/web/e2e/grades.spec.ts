import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The home page as a hub of classes: tiles lead to `/tridy/[gradeId]`, the
 * last opened class is remembered in the browser and "Všechny třídy"
 * (`/?vse=1`) suppresses the redirect to it. The class page can add and move
 * a topic.
 *
 * The empty library (review item 5) is not checked e2e — all test accounts
 * share one seeded school, so none of them has an empty library, and setting
 * up a separate empty school just for this test would cost new infrastructure
 * for a single case. Instead `apps/web/test/library-api.test.ts` has a unit
 * test for exactly the condition on which the home page switches to
 * `EmptyState` — `loadLibraryTree` returns an empty array for a school without data.
 */

const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Creates a subject with one grade via the API and returns both ids. */
async function createGrade(
  request: APIRequestContext,
  subjectName: string,
  gradeName: string,
): Promise<{ subjectId: string; gradeId: string }> {
  const subject = await request.post('/api/library', {
    data: { kind: 'subject', name: subjectName },
  })
  expect(subject.ok(), 'could not create the test subject').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }

  const grade = await request.post('/api/library', {
    data: { kind: 'grade', name: gradeName, parentId: subjectId },
  })
  expect(grade.ok(), 'could not create the test grade').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  return { subjectId, gradeId }
}

async function deleteSubject(request: APIRequestContext, subjectId: string): Promise<void> {
  const deleted = await request.delete(`/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`)
  expect(deleted.ok(), 'could not clean up the test subject').toBe(true)
}

/** Fills in the open dialog and confirms it. */
async function fillDialog(page: Page, field: string, value: string, submitLabel: string) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(field).fill(value)
  await dialog.getByRole('button', { name: submitLabel, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('class hub', () => {
  test('a class tile leads to the class page', async ({ page }) => {
    // Own stamp in the grade name too — the seed has real "6./7./8. ročník" and
    // searching by the number alone could hit them.
    const GRADE = `5. ročník ${STAMP}`
    const { subjectId, gradeId } = await createGrade(page.request, `E2E TRIDY DLAZDICE ${STAMP}`, GRADE)
    try {
      await page.goto('/?vse=1')
      // The same link now also leads from the sidebar, not only from the tile —
      // so look only in the content area, otherwise two elements would match.
      const content = page.getByRole('region', { name: 'Třídy' })
      await content.locator(`a[href="/tridy/${gradeId}"]`).click()
      await expect(page).toHaveURL(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
    } finally {
      await deleteSubject(page.request, subjectId)
    }
  })

  test('a class link in the sidebar opens the class page with its topics in the middle', async ({
    page,
  }) => {
    // Three columns belong to the home page and the class page too, not only to
    // the topic — so the sidebar with grades is visible on both and leads to the
    // same class page, whose middle column shows its topics right away.
    const GRADE = `4. ročník ${STAMP}`
    const TOPIC = `Téma v postranním panelu ${STAMP}`
    const { subjectId, gradeId } = await createGrade(page.request, `E2E TRIDY PANEL ${STAMP}`, GRADE)
    const topic = await page.request.post('/api/library', {
      data: { kind: 'topic', name: TOPIC, parentId: gradeId },
    })
    expect(topic.ok(), 'could not create the test topic').toBe(true)

    try {
      await page.goto('/?vse=1')
      const sidebar = page.getByRole('complementary', { name: 'Předměty a ročníky' })
      await sidebar.getByRole('link', { name: GRADE, exact: false }).click()

      await expect(page).toHaveURL(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()

      const middleColumn = page.getByRole('complementary', { name: 'Témata ročníku' })
      await expect(middleColumn.getByText(TOPIC, { exact: true })).toBeVisible()
    } finally {
      await deleteSubject(page.request, subjectId)
    }
  })

  test('after visiting a class, a new visit to the home page lands on it', async ({ page }) => {
    const GRADE = `6. ročník ${STAMP}`
    const { subjectId, gradeId } = await createGrade(page.request, `E2E TRIDY PAMET ${STAMP}`, GRADE)
    try {
      await page.goto(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
      // The heading is visible from server rendering already; the class is
      // remembered only by an effect after hydration. Without waiting the test
      // would move on too early (WebKit does).
      await expect.poll(() => page.evaluate(() => Object.values(localStorage))).toContain(gradeId)

      // A new visit to the home page without `?vse=1` redirects straight to the remembered class.
      await page.goto('/')
      await page.waitForURL(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
    } finally {
      await deleteSubject(page.request, subjectId)
    }
  })

  test('the "Třídy" bar item shows the tiles even with a remembered class', async ({ page }) => {
    const GRADE = `9. ročník ${STAMP}`
    const { subjectId, gradeId } = await createGrade(page.request, `E2E TRIDY LISTA ${STAMP}`, GRADE)
    try {
      await page.goto(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()

      // Clicking "Třídy" in the bar must not land back in the remembered class —
      // it always leads to the tile overview (`/?vse=1`), like the "Všechny třídy" link.
      await page.getByRole('link', { name: 'Třídy', exact: true }).click()
      await expect(page).toHaveURL('/?vse=1')
      await expect(page.getByText(GRADE, { exact: false }).first()).toBeVisible()
    } finally {
      await deleteSubject(page.request, subjectId)
    }
  })

  test('"Všechny třídy" shows the tiles even with a remembered class', async ({ page }) => {
    const GRADE = `7. ročník ${STAMP}`
    const { subjectId, gradeId } = await createGrade(page.request, `E2E TRIDY VSECHNY ${STAMP}`, GRADE)
    try {
      await page.goto(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()

      await page.goto('/?vse=1')
      // The redirect is suppressed — the tiles stay, not the class page.
      await expect(page).toHaveURL('/?vse=1')
      await expect(page.getByText(GRADE, { exact: false }).first()).toBeVisible()
    } finally {
      await deleteSubject(page.request, subjectId)
    }
  })

  test('a deleted remembered class — the home page silently forgets it and shows the tiles', async ({ page }) => {
    const GRADE = `8. ročník ${STAMP}`
    const { subjectId, gradeId } = await createGrade(page.request, `E2E TRIDY SMAZANA ${STAMP}`, GRADE)
    // Visit the grade so it gets remembered, then delete it along with the
    // subject — the remembered link now points at something no longer in the library.
    await page.goto(`/tridy/${gradeId}`)
    await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
    await deleteSubject(page.request, subjectId)

    await page.goto('/')
    // No redirect to a 404: the home page drops the forgotten class and shows the tiles.
    await expect(page).toHaveURL('/')
    await expect(page.getByText(GRADE, { exact: false })).toHaveCount(0)
    await expect(page.locator('a[href^="/tridy/"]').first()).toBeVisible()
  })

  test('a foreign or missing class leads to the Czech message "Třída už neexistuje"', async ({ page }) => {
    // In the dev server Next.js returns a `notFound()` page with status 200
    // (only the production build fixes that) — so the content is checked.
    await page.goto('/tridy/neexistujici-trida-xyz')
    await expect(page.getByText('Třída už neexistuje')).toBeVisible()
    const back = page.getByRole('link', { name: 'Všechny třídy' })
    await expect(back).toBeVisible()
    await back.click()
    await expect(page).toHaveURL('/?vse=1')
  })
})

test.describe('managing a topic on the class page', () => {
  test('adds a topic and moves it to another grade of the same subject', async ({ page }) => {
    const subjectName = `E2E TRIDY SPRAVA ${STAMP}`
    const GRADE_1 = `1. ročník ${STAMP}`
    const GRADE_2 = `2. ročník ${STAMP}`
    const { subjectId, gradeId: gradeId1 } = await createGrade(page.request, subjectName, GRADE_1)
    const grade2 = await page.request.post('/api/library', {
      data: { kind: 'grade', name: GRADE_2, parentId: subjectId },
    })
    expect(grade2.ok()).toBe(true)
    const { id: gradeId2 } = (await grade2.json()) as { id: string }

    const TOPIC = `Přesouvané téma ${STAMP}`

    try {
      // --- Adding a topic on the class page ---------------------------------
      await page.goto(`/tridy/${gradeId1}`)
      await page.getByRole('button', { name: 'Přidat téma' }).click()
      await fillDialog(page, 'Název tématu', TOPIC, 'Založit')

      // After the topic is created its own page opens.
      await expect(page).toHaveURL(/\/topics\//)
      await expect(page.getByRole('heading', { name: TOPIC, exact: true })).toBeVisible()

      // --- Moving to another grade ------------------------------------------
      await page.goto(`/tridy/${gradeId1}`)
      await expect(page.getByText(TOPIC, { exact: true }).first()).toBeVisible()

      const move = page.getByLabel('Přesunout téma do jiného ročníku')
      await move.click()
      await page.getByRole('option', { name: GRADE_2, exact: true }).click()

      await expect(page.getByText(`Téma přesunuto do ${GRADE_2}`)).toBeVisible()

      // The topic disappears from the old class...
      await expect(page.getByText(TOPIC, { exact: true })).toHaveCount(0)

      // ...and appears in the new one.
      await page.goto(`/tridy/${gradeId2}`)
      await expect(page.getByText(TOPIC, { exact: true }).first()).toBeVisible()
    } finally {
      await deleteSubject(page.request, subjectId)
    }
  })
})

test.describe('old addresses', () => {
  test('/?grade=<id> with invalid characters in the id does not break the redirect', async ({ page }) => {
    // `encodeURIComponent` in the redirect target — without it an id with a
    // slash or question mark would spill into the query of another path.
    await page.goto(`/?grade=${encodeURIComponent('divne/id?a=b')}`)
    await expect(page).toHaveURL(/\/tridy\/divne%2Fid%3Fa%3Db$/)
  })

  test('/questions and /review with topicId lead to that topic, without it to the home page', async ({ page }) => {
    const subjectName = `E2E STARE ADRESY ${STAMP}`
    const { subjectId, gradeId } = await createGrade(page.request, subjectName, `Ročník ${STAMP}`)
    try {
      const topic = await page.request.post('/api/library', {
        data: { kind: 'topic', name: 'Téma pro starou adresu', parentId: gradeId },
      })
      expect(topic.ok(), 'could not create the test topic').toBe(true)
      const { id: topicId } = (await topic.json()) as { id: string }

      await page.goto(`/questions?topicId=${topicId}`)
      await expect(page).toHaveURL(`/topics/${topicId}`)

      await page.goto(`/review?topicId=${topicId}`)
      await expect(page).toHaveURL(`/topics/${topicId}`)

      await page.goto('/questions')
      await expect(page).toHaveURL('/')

      await page.goto('/review')
      await expect(page).toHaveURL('/')
    } finally {
      await deleteSubject(page.request, subjectId)
    }
  })
})
