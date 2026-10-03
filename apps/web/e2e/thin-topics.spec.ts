import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Warning about thin topics: below `MIN_USABLE_TOPIC_CHARS` characters of
 * usable text (without duplicates) a test cannot be filled reliably. The app
 * should hint at it calmly, not alarmingly, on the tile and in the topic
 * detail. The test creates its own topic with a short material so it does not
 * depend on which real topic happens to be thin.
 */

async function createLowContentTopic(request: APIRequestContext) {
  const response = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: 'PODKLADY/9. ročník/Chudé téma.txt',
          fileName: 'Chudé téma.txt',
          subject: 'PODKLADY',
          grade: '9. ročník',
          topic: 'Chudé téma',
          mimeType: 'text/plain',
          sizeBytes: 40,
          // Well below MIN_USABLE_TOPIC_CHARS (1000 characters).
          text: 'Pár vět jen pro ověření upozornění na málo textu.',
          pageCount: null,
          needsOcr: false,
          contentHash: `podklady-low-${Date.now()}`,
        },
      ],
    },
  })
  expect(response.ok()).toBe(true)
}

test.describe('thin topic warning', () => {
  test('the tile and the topic detail hint that there are few materials', async ({ page }) => {
    await createLowContentTopic(page.request)

    // `?vse=1` on every home page visit: otherwise the test visits one of the
    // topics' classes (stored in the browser as the last opened one) and the
    // next `/` would silently redirect to it instead of showing the tiles.
    //
    // Library search leads straight to the detail of the newly created topic.
    // In WebKit `fill()` does not trigger React onChange on this field, so the
    // query is typed character by character like the teacher would.
    await page.goto('/?vse=1')
    await page.getByPlaceholder('Hledat v celé knihovně…').pressSequentially('Chudé téma')
    const result = page.getByRole('button', { name: /Chudé téma/ })
    await expect(result).toBeVisible()
    await result.click()

    // The topic detail explains what little text means and still allows generating.
    await expect(page.getByRole('heading', { name: 'Chudé téma' })).toBeVisible()
    await expect(page.getByTestId('thin-topic-warning')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generovat otázky' })).toBeVisible()

    // And the same calm note is visible on the tile in the grade overview.
    await page.goto('/?vse=1')
    // The grade is looked up in its own subject's section — "the first 9. ročník
    // on the page" would hit another subject as soon as the library holds anything else.
    const subjectOverview = page
      .locator('section', { has: page.getByRole('heading', { name: 'PODKLADY', exact: true }) })
      .last()
    await subjectOverview.getByRole('link', { name: '9. ročník' }).first().click()
    await expect(page.getByTestId('topic-low-content').first()).toBeVisible()

    // Clean up — the test created its own subject, it does not belong in the real library.
    await page.goto('/?vse=1')
    const subjectSection = page
      .locator('section', { has: page.locator('h2', { hasText: 'PODKLADY' }) })
      .last()
    await expect(subjectSection).toBeVisible()
    await subjectSection.getByRole('button', { name: 'Smazat předmět' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page.locator('h2', { hasText: 'PODKLADY' })).toHaveCount(0)
  })
})

/**
 * The same file sometimes belongs to two topics — a worksheet is taught in
 * both the seventh and the eighth grade. So the library must not silently
 * swallow it the second time as a duplicate: it must be visible in both topics.
 */
test.describe('same file in two topics', () => {
  test('a sheet imported into two grades is visible in both', async ({ page }) => {
    const hash = `podklady-sdileny-${Date.now()}`
    const fileName = 'Sdílený pracovní list.txt'
    const text = 'Opakování na pracovním listu. '.repeat(50)

    const response = await page.request.post('/api/materials', {
      data: {
        materials: ['7. ročník', '8. ročník'].map((grade) => ({
          relativePath: `PODKLADY/${grade}/Sdílené téma/${fileName}`,
          fileName,
          subject: 'PODKLADY',
          grade,
          topic: 'Sdílené téma',
          mimeType: 'text/plain',
          sizeBytes: text.length,
          text,
          pageCount: null,
          needsOcr: false,
          // Same content, hence the same hash — and still two materials.
          contentHash: hash,
        })),
      },
    })
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ imported: 2, duplicates: 0 })

    // Both topics can be found and both show the file as a full material, not
    // as a set-aside duplicate.
    for (const grade of ['7. ročník', '8. ročník']) {
      await page.goto('/?vse=1')
      const search = page.getByPlaceholder('Hledat v celé knihovně…')
      const result = page.getByRole('button', { name: new RegExp(`Sdílené téma.*${grade}`, 's') })
      // React drops characters typed before hydration, so typing is repeated
      // until the result shows.
      await expect(async () => {
        await search.clear()
        await search.pressSequentially('Sdílené téma')
        await expect(result).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await result.click()

      await expect(page.getByRole('heading', { name: 'Sdílené téma' })).toBeVisible()
      // The material list is collapsed; the file name shows only after expanding
      // it via the toggle in its header.
      await page.getByRole('button', { name: /^Materiály/ }).click()
      await expect(page.getByText(fileName).first()).toBeVisible()
      await expect(page.getByTestId('material-duplicate-of')).toHaveCount(0)
      await expect(page.getByTestId('thin-topic-warning')).toHaveCount(0)
    }

    // Clean up — the test subject does not belong in the real library.
    await page.goto('/?vse=1')
    const subjectSection = page
      .locator('section', { has: page.locator('h2', { hasText: 'PODKLADY' }) })
      .last()
    await expect(subjectSection).toBeVisible()
    await subjectSection.getByRole('button', { name: 'Smazat předmět' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page.locator('h2', { hasText: 'PODKLADY' })).toHaveCount(0)
  })
})
