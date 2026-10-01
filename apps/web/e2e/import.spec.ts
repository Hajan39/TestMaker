import { expect, test } from '@playwright/test'

/**
 * Import preview. Until the teacher reviews the filing, nothing may appear in
 * the library — the Subject → Grade → Topic guess from the path is what most
 * often misses. So the test imports two standalone files (no folder, hence an
 * empty filing), fills in the filing in the preview, leaves one row out and
 * only then saves.
 */

const SUBJECT = 'PŘÍRODOPIS'
const GRADE = '7. ročník'
const TOPIC = 'Hmyz a jeho vývoj'

/** Text long enough that the file isn't discarded as empty and the topic isn't thin. */
function text(sentence: string): string {
  return `${sentence} `.repeat(30)
}

const KEPT = {
  name: 'Hmyz a jeho vývoj.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(text('Hmyz prochází proměnou dokonalou nebo nedokonalou.'), 'utf8'),
}

const DROPPED = {
  name: '7.4 Hmyz a jeho vývoj (opakování).txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(text('Opakování na hmyz před písemkou z bezobratlých.'), 'utf8'),
}

test.describe('import preview', () => {
  test('standalone files are filed by hand and only the selected ones are saved', async ({ page }) => {
    // Clean up after a possibly crashed earlier run: a topic of the same name
    // would break the "nothing in the library until the preview is confirmed" check.
    const leftovers = await page.request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
    for (const found of ((await leftovers.json()) as { results: { topicId: string }[] }).results) {
      await page.request.delete(`/api/library?kind=topic&id=${encodeURIComponent(found.topicId)}`)
    }

    await page.goto('/import')

    // Next to the folder picker there must be a file picker and a drop zone.
    await expect(page.getByRole('button', { name: 'Vybrat složku' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Vybrat soubory' })).toBeVisible()
    await expect(page.getByText('přetáhni myší')).toBeVisible()

    await page.locator('[data-testid="import-files"]').setInputFiles([KEPT, DROPPED])

    // Both files belong to the same topic, so they form a single group — and
    // since a standalone file's path says nothing, it stays without a subject.
    const group = page.locator('[data-testid="import-group"]')
    await expect(group).toHaveCount(1)
    await expect(page.getByText('Předmět z cesty vyčíst nešel')).toBeVisible()
    await expect(group.getByLabel('Téma')).toHaveValue(TOPIC)

    // Until the preview is confirmed, the library has nothing.
    const before = await page.request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
    expect(((await before.json()) as { results: unknown[] }).results).toHaveLength(0)

    // Type the filing character by character like the teacher would: `fill()`
    // in WebKit doesn't fire React onChange on these fields.
    await group.getByLabel('Předmět').pressSequentially(SUBJECT)
    await group.getByLabel('Ročník').pressSequentially(GRADE)

    // Leave one row out — only the other should go into the library.
    await group.getByRole('checkbox', { name: `Zahrnout ${DROPPED.name}` }).click()
    await expect(page.getByRole('button', { name: 'Importovat (1)' })).toBeVisible()

    await page.getByRole('button', { name: 'Importovat (1)' }).click()
    await expect(page.getByText(/Naimportováno 1 materiál/)).toBeVisible()

    // After import it offers where to continue — not just an overview.
    await expect(page.getByRole('button', { name: `Ročník ${GRADE}` })).toBeVisible()
    await page.getByRole('button', { name: `Téma ${TOPIC}` }).click()

    await expect(page).toHaveURL(/\/topics\//)
    await expect(page.getByRole('heading', { name: TOPIC })).toBeVisible()

    // Materials are collapsed on the topic page; expand them to see what was
    // imported and what wasn't.
    await page.getByRole('button', { name: /^Materiály/ }).click()
    await expect(page.getByText(KEPT.name).first()).toBeVisible()
    await expect(page.getByText(DROPPED.name)).toHaveCount(0)

    // Clean up: the topic created by the test must not stay in the library.
    const topicId = new URL(page.url()).pathname.split('/').pop() ?? ''
    expect(topicId).not.toHaveLength(0)
    const deleted = await page.request.delete(
      `/api/library?kind=topic&id=${encodeURIComponent(topicId)}`,
    )
    expect(deleted.ok(), 'failed to clean up the test topic').toBe(true)
  })
})
