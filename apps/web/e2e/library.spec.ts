import { expect, test, type Page } from '@playwright/test'

/**
 * Manual library management: a subject, grade and topic can be created and
 * renamed from the UI, without importing files. The test creates everything
 * under its own timestamped name (it runs in both chromium and webkit against
 * the same database) and cleans up at the end by deleting the subject — that
 * cascades, so the grades and topics go with it.
 */

const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const SUBJECT = `E2E KNIHOVNA ${STAMP}`
const SUBJECT_NEW = `E2E Knihovna ${STAMP}`
const GRADE_NAME = `2. ročník ${STAMP}`
const GRADE_NEW = `9. ročník ${STAMP}`
const GRADE_SECOND = `3. ročník ${STAMP}`
const TOPIC = `Vlastní téma ${STAMP}`
const TOPIC_NEW = `Přepsané téma ${STAMP}`

/** Fills in the open dialog and confirms it. */
async function fillDialog(page: Page, field: string, value: string, submitLabel: string) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(field).fill(value)
  await dialog.getByRole('button', { name: submitLabel, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('manual library management', () => {
  test('creates and renames a subject, grade and topic', async ({ page }) => {
    let subjectId: string | null = null

    try {
      await page.goto('/')

      // --- New subject from the home page --------------------------------
      await page.getByRole('button', { name: 'Založit předmět' }).click()

      const creation = page.waitForResponse(
        (response) => response.url().includes('/api/library') && response.request().method() === 'POST',
      )
      await fillDialog(page, 'Název předmětu', SUBJECT, 'Založit')
      subjectId = ((await (await creation).json()) as { id: string }).id

      const subjectHeading = page.getByRole('heading', { name: SUBJECT, exact: true })
      await expect(subjectHeading).toBeVisible()

      // --- New grade in that subject ---------------------------------------
      // `.last()` is the innermost section; layout panes are `section`s too.
      const section = page.locator('section', { has: subjectHeading }).last()
      await section.getByRole('button', { name: 'Nový ročník' }).click()
      await fillDialog(page, 'Název ročníku', GRADE_NAME, 'Založit')

      // After creating, the new class opens right away.
      await expect(page).toHaveURL(/\/tridy\//)
      await expect(page.getByRole('heading', { name: GRADE_NAME, exact: true })).toBeVisible()
      const gradeUrl = page.url()

      // --- New topic in the grade ------------------------------------------
      await page.getByRole('button', { name: 'Přidat téma' }).click()
      await fillDialog(page, 'Název tématu', TOPIC, 'Založit')

      // And it opens right away so it can be filled in.
      await expect(page).toHaveURL(/\/topics\//)
      await expect(page.getByRole('heading', { name: TOPIC, exact: true })).toBeVisible()
      // A topic without materials must not break the overview — the counts are just zero.
      await expect(page.getByText('materiálů', { exact: false }).first()).toBeVisible()

      // --- Renaming the topic (in place, no dialog) ------------------------
      await page.goto(gradeUrl)
      await expect(page.getByText(TOPIC, { exact: true }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Přejmenovat téma' }).first().click()
      const topicField = page.getByRole('textbox', { name: 'Přejmenovat téma' })
      await topicField.fill(TOPIC_NEW)
      await topicField.press('Enter')
      await expect(page.getByText(TOPIC_NEW, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(TOPIC, { exact: true })).toHaveCount(0)

      // --- Renaming the grade ----------------------------------------------
      await page.getByRole('button', { name: 'Přejmenovat ročník' }).click()
      await fillDialog(page, 'Název ročníku', GRADE_NEW, 'Uložit')
      await expect(page.getByRole('heading', { name: GRADE_NEW, exact: true })).toBeVisible()

      // The change shows in the home page tile too. The sidebar link now carries
      // the same name, so look only in the content area.
      await page.goto('/?vse=1')
      const introContent = page.getByRole('region', { name: 'Třídy' })
      await expect(introContent.getByText(GRADE_NEW, { exact: false })).toBeVisible()

      // --- Two grades with the same name are refused, with the reason -----
      const subjectHeadingAgain = page.getByRole('heading', { name: SUBJECT, exact: true })
      await expect(subjectHeadingAgain).toBeVisible()
      const sectionSecond = page.locator('section', { has: subjectHeadingAgain }).last()
      await sectionSecond.getByRole('button', { name: 'Nový ročník' }).click()
      await fillDialog(page, 'Název ročníku', GRADE_SECOND, 'Založit')
      await expect(page).toHaveURL(/\/tridy\//)
      await expect(page.getByRole('heading', { name: GRADE_SECOND, exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Přejmenovat ročník' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Název ročníku').fill(GRADE_NEW)
      await dialog.getByRole('button', { name: 'Uložit', exact: true }).click()
      await expect(dialog).toContainText('už je')
      await expect(dialog).toContainText('Upravit téma')
      await dialog.getByRole('button', { name: 'Zrušit' }).click()
      await expect(page.getByRole('heading', { name: GRADE_SECOND, exact: true })).toBeVisible()

      // --- Renaming the subject --------------------------------------------
      // `?vse=1`, otherwise the home page would redirect to the last opened class.
      await page.goto('/?vse=1')
      const sectionAgain = page.locator('section', { has: subjectHeading }).last()
      await sectionAgain.getByRole('button', { name: 'Přejmenovat předmět' }).click()
      await fillDialog(page, 'Název předmětu', SUBJECT_NEW, 'Uložit')

      await expect(page.getByRole('heading', { name: SUBJECT_NEW, exact: true })).toBeVisible()
      await expect(subjectHeading).toHaveCount(0)
    } finally {
      // Clean up even after a failed test: the grades and topics go with the subject.
      if (subjectId) {
        const deleted = await page.request.delete(
          `/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`,
        )
        expect(deleted.ok(), 'could not clean up the test subject').toBe(true)
      }
    }
  })
})
