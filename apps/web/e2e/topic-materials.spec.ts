import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The topic's materials strip: uploading files straight here (no detour via
 * `/import`), re-uploading the same file doesn't duplicate it, an unsupported
 * file ends up among the skipped, and the "Použít pro generování" toggle
 * changes the strip header count right away.
 *
 * The `nahled` role (no upload, toggle or delete) is in `role.spec.ts` — it
 * runs under the sign-in config this file doesn't have.
 */

const SUBJECT = 'E2E MATERIALY'
const GRADE = 'E2E pruh materiálů'
const TOPIC = 'Pruh materiálů v tématu'

/** Text long enough that the material isn't flagged as "skoro bez textu". */
function text(sentence: string): string {
  return `${sentence} `.repeat(30)
}

/** Creates a test topic with one material and returns its id. */
async function ensureTopic(request: APIRequestContext): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${TOPIC}/Úvodní materiál.txt`,
          fileName: 'Úvodní materiál.txt',
          subject: SUBJECT,
          grade: GRADE,
          topic: TOPIC,
          mimeType: 'text/plain',
          sizeBytes: 400,
          text: text('Úvodní materiál založený přes API, aby téma existovalo.'),
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-tema-materialy-uvod-${Date.now()}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'failed to import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC))
  expect(topic, `test topic "${TOPIC}" not found in the library`).toBeTruthy()
  return topic!.topicId
}

async function cleanup(request: APIRequestContext, topicId: string) {
  const deleted = await request.delete(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
  expect(deleted.ok(), 'failed to clean up the test topic').toBe(true)
}

/** Expands the materials strip — it is collapsed when there are materials. */
async function expandStrip(page: Page) {
  const trigger = page.getByRole('button', { name: /^Materiály/ })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
}

test.describe('topic materials strip', () => {
  test('two uploaded files appear in the strip and are not duplicated the second time', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const first = {
        name: 'Nahraný přímo do tématu 1.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text('První soubor nahraný rovnou do tématu.'), 'utf8'),
      }
      const second = {
        name: 'Nahraný přímo do tématu 2.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text('Druhý soubor nahraný rovnou do tématu.'), 'utf8'),
      }

      await page.locator('[data-testid="topic-material-files"]').setInputFiles([first, second])
      await expect(page.getByText(/Nahráno 2 materiály/)).toBeVisible()
      await expect(page.getByText(first.name)).toBeVisible()
      await expect(page.getByText(second.name)).toBeVisible()

      // Uploading the same file again: no duplicate, and the message says so —
      // nothing is saved this time, so the sentence only talks about duplicates.
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([first])
      await expect(page.getByText('Všechny soubory už v tématu byly.')).toBeVisible()
      await expect(page.getByText(first.name)).toHaveCount(1)
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('an unsupported file ends up among the skipped', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const unsupported = {
        name: 'poznamky.xyz',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('obsah v nepodporovaném formátu', 'utf8'),
      }
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([unsupported])

      await page.getByText(/^Přeskočeno/).click()
      await expect(page.getByText(unsupported.name)).toBeVisible()
      await expect(page.getByText('nepodporovaná přípona')).toBeVisible()
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('turning off "Použít pro generování" lowers the strip header count', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const header = page.getByRole('button', { name: /^Materiály/ })
      await expect(header).toContainText('Materiály 1')
      // The space between the word and the number must be real — otherwise the
      // button's accessible name would be "Materiály1" and a screen reader
      // would read it as one word.
      await expect(header).toHaveAccessibleName(/Materiály 1/)

      await page.getByRole('checkbox', { name: /Použít pro generování: Úvodní materiál\.txt/ }).click()

      await expect(header).toContainText('Materiály 0 + 1 vynechaný')
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('a file without text ends up among the skipped, not without a trace', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // Fewer than 40 characters — extraction treats it as empty, not as a scan.
      const empty = {
        name: 'prazdna-poznamka.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('pár slov', 'utf8'),
      }
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([empty])

      await page.getByText(/^Přeskočeno/).click()
      await expect(page.getByText(empty.name)).toBeVisible()
      await expect(page.getByText('soubor neobsahuje žádný text')).toBeVisible()
      // It wasn't added to the topic's materials.
      await expect(page.getByText(empty.name).locator('..').getByRole('checkbox')).toHaveCount(0)
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('a duplicate row has the "Použít pro generování" checkbox unchecked and locked', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // A second file with a subset of the content of the first one that
      // created the topic (`ensureTopic`) — the shorter text guarantees it is
      // recognised as its duplicate and not vice versa (the longer one wins).
      const duplicate = {
        name: 'Duplicitní kopie.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text('Úvodní materiál založený přes API, aby téma existovalo.').slice(0, 200), 'utf8'),
      }
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([duplicate])
      await expect(page.getByText('stejný obsah jako')).toBeVisible()

      const duplicateCheckbox = page.getByRole('checkbox', {
        name: `Použít pro generování: ${duplicate.name}`,
      })
      await expect(duplicateCheckbox).not.toBeChecked()
      await expect(duplicateCheckbox).toBeDisabled()
    } finally {
      await cleanup(page.request, topicId)
    }
  })
})
