import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Zaškrtávání otázek v tématu a vytvoření testu z výběru. Lišta dole ukazuje
 * počet a body a „Vytvořit test“ založí novou písemku rovnou z vybraných
 * otázek.
 *
 * Vlastní zkušební téma (vzor `ensureTopic` z `tema-otazky.spec.ts`) —
 * nesdílí se s ostatními soubory, ať počet karet nezávisí na tom, co tam
 * zůstalo z jiného běhu.
 */

const SUBJECT = 'E2E VYBER'
const GRADE = 'E2E výběr do testu'
const TOPIC = 'Výběr otázek do testu'

const TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

async function ensureTopic(
  request: APIRequestContext,
  topic: string = TOPIC,
  grade: string = GRADE,
): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${grade}/${topic}.txt`,
          fileName: `${topic}.txt`,
          subject: SUBJECT,
          grade,
          topic,
          mimeType: 'text/plain',
          sizeBytes: TEXT.length,
          text: TEXT,
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-tema-vyber-v1:${topic}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(topic)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const found2 = results.find((result) => result.topicName.includes(topic))
  expect(found2, `zkušební téma „${topic}“ se v knihovně nenašlo`).toBeTruthy()
  return found2!.topicId
}

async function pridatOtazku(
  request: APIRequestContext,
  topicId: string,
  prompt: string,
  points = 1,
): Promise<string> {
  const created = await request.post('/api/questions', {
    data: {
      topicId,
      question: {
        type: 'short_answer',
        difficulty: 1,
        points,
        blocks: [],
        payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
      },
    },
  })
  expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

test.describe('výběr otázek do testu', () => {
  test('zaškrtnutí ukáže lištu, smazání vybrané ji zmenší, vytvoření testu založí písemku', async ({
    page,
  }) => {
    const topicId = await ensureTopic(page.request)
    const a = `Výběr karta A ${Date.now()}`
    const b = `Výběr karta B ${Date.now()}`
    const c = `Výběr karta C ${Date.now()}`
    await pridatOtazku(page.request, topicId, a, 2)
    await pridatOtazku(page.request, topicId, b, 3)
    await pridatOtazku(page.request, topicId, c, 1)

    await page.goto(`/topics/${topicId}`)
    const rowA = page.locator('li[data-question-id]', { hasText: a })
    const rowB = page.locator('li[data-question-id]', { hasText: b })
    const rowC = page.locator('li[data-question-id]', { hasText: c })
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()
    await expect(rowC).toBeVisible()

    // Lišta zatím není vidět — nic není vybráno.
    await expect(page.getByText(/^Vybráno/)).toHaveCount(0)

    await rowA.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await rowB.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await expect(page.getByText('Vybráno 2 · 5 bodů')).toBeVisible()

    // Smazání vybrané karty ji odečte z výběru i ze součtu bodů.
    await rowB.getByRole('button', { name: 'Smazat' }).click()
    await expect(rowB).toHaveCount(0)
    await expect(page.getByText('Vybráno 1 · 2 body')).toBeVisible()

    await rowC.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await expect(page.getByText('Vybráno 2 · 3 body')).toBeVisible()

    await page.getByRole('button', { name: 'Vytvořit test' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+/.test(url.pathname))
    await expect(page).toHaveURL(new RegExp(`tema=${topicId}`))

    // V osnově jsou obě otázky, v pořadí, jak stály v seznamu tématu shora —
    // to je nejnovější první, takže C (přidaná poslední) je nad A.
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rows.filter({ hasText: a })).toHaveCount(1)
    await expect(rows.filter({ hasText: c })).toHaveCount(1)
    const indexA = await rows.filter({ hasText: a }).first().evaluate((el) => Array.from(el.parentElement!.children).indexOf(el))
    const indexC = await rows.filter({ hasText: c }).first().evaluate((el) => Array.from(el.parentElement!.children).indexOf(el))
    expect(indexC).toBeLessThan(indexA)

    // Název testu = název tématu.
    await expect(page.getByLabel('Název písemky')).toHaveValue(/Výběr otázek do testu/)

    // Hlavička ukazuje třídu, ze které test vznikl, a odkaz zpět do tématu.
    const backLink = page.getByRole('link', { name: /Zpět do tématu/ })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', `/topics/${topicId}`)
    await expect(backLink.locator('..')).toContainText(`${SUBJECT} · ${GRADE}`)

    // Druhé téma v jiném ročníku — ve výchozím filtru (třída testu) banka
    // ukazuje jen téma vlastní třídy; po přepnutí na „Všechny třídy“ i to druhé.
    // Ročník i téma mají v názvu čas — jinak by novou položku pohltilo
    // seskupení podobných témat do staré položky ze dřívějšího běhu.
    const otherGrade = `${GRADE} jiná třída ${Date.now()}`
    const otherTopic = `${TOPIC} jinde ${Date.now()}`
    const otherTopicId = await ensureTopic(page.request, otherTopic, otherGrade)
    await pridatOtazku(page.request, otherTopicId, `Otázka z jiné třídy ${Date.now()}`, 1)
    await page.reload()

    const bankOwnGrade = page.getByText(new RegExp(`${SUBJECT} · ${otherGrade} · `))
    await expect(bankOwnGrade).toHaveCount(0)

    await page.getByLabel('Ročník').click()
    await page.getByRole('option', { name: 'Všechny třídy' }).click()
    await expect(bankOwnGrade).toBeVisible()
  })

  test('„Zrušit výběr“ schová lištu', async ({ page }) => {
    const topicId = await ensureTopic(page.request, `${TOPIC} zrušení`)
    const prompt = `Výběr ke zrušení ${Date.now()}`
    await pridatOtazku(page.request, topicId, prompt, 1)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await row.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await expect(page.getByText('Vybráno 1 · 1 bod')).toBeVisible()

    await page.getByRole('button', { name: 'Zrušit výběr' }).click()
    await expect(page.getByText(/^Vybráno/)).toHaveCount(0)
  })
})
