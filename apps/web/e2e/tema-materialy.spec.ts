import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Pruh materiálů v tématu: nahrání souborů rovnou sem (bez oklikou přes
 * `/import`), opakované nahrání téhož souboru se nezdvojí, nepodporovaný
 * soubor skončí mezi přeskočenými a přepínač „Použít pro generování“ hned
 * mění počet v hlavičce pruhu.
 *
 * Role `nahled` (bez nahrávání, přepínače a mazání) je v `role.spec.ts` —
 * ten běží přes přihlašovací konfiguraci, kterou tenhle soubor nemá.
 */

const SUBJECT = 'E2E MATERIALY'
const GRADE = 'E2E pruh materiálů'
const TOPIC = 'Pruh materiálů v tématu'

/** Dost dlouhý text, aby materiál nebyl označený jako „skoro bez textu“. */
function text(sentence: string): string {
  return `${sentence} `.repeat(30)
}

/** Založí zkušební téma s jedním materiálem a vrátí jeho id. */
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
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC))
  expect(topic, `zkušební téma „${TOPIC}“ se v knihovně nenašlo`).toBeTruthy()
  return topic!.topicId
}

async function cleanup(request: APIRequestContext, topicId: string) {
  const deleted = await request.delete(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
  expect(deleted.ok(), 'zkušební téma se nepodařilo uklidit').toBe(true)
}

/** Rozbalí pruh materiálů — s materiály je sbalený. */
async function expandStrip(page: Page) {
  const trigger = page.getByRole('button', { name: /^Materiály/ })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
}

test.describe('pruh materiálů v tématu', () => {
  test('nahrání dvou souborů se objeví v pruhu a podruhé se nezdvojí', async ({ page }) => {
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

      // Nahrání téhož souboru podruhé: nezdvojí se a hláška to řekne rovnou.
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([first])
      await expect(page.getByText(/už v tématu bylo/)).toBeVisible()
      await expect(page.getByText(first.name)).toHaveCount(1)
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('nepodporovaný soubor skončí mezi přeskočenými', async ({ page }) => {
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

  test('vypnutí „Použít pro generování“ sníží počet v hlavičce pruhu', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const header = page.getByRole('button', { name: /^Materiály/ })
      await expect(header).toContainText('Materiály1')

      await page.getByRole('checkbox', { name: /Použít pro generování: Úvodní materiál\.txt/ }).click()

      await expect(header).toContainText('Materiály0 + 1 vynechaných')
    } finally {
      await cleanup(page.request, topicId)
    }
  })
})
