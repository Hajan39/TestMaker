import { expect, test } from '@playwright/test'

/**
 * Záloha knihovny v prohlížeči: stažení celého souboru a obnova z něj.
 *
 * Právě tyhle dvě věci se jinde ověřit nedají — stahování jde přes hlavičku
 * `content-disposition` a obnova přes výběr souboru, a obojí se chová v každém
 * prohlížeči trochu jinak. Obnova se schválně spouští dvakrát: druhý běh
 * nesmí nic zdvojit.
 */

/** Vlastní předmět, aby se testu nepletly pod ruku data ostatních testů. */
const PREDMET = 'E2E ZÁLOHA'
const TEMA = 'Obnovené téma'

const IDS = {
  subject: 'e2e-zaloha-predmet',
  grade: 'e2e-zaloha-rocnik',
  topic: 'e2e-zaloha-tema',
  question: 'e2e-zaloha-otazka',
}

const TEXT = 'Obnovený materiál k tématu. '.repeat(20)

/** Malá, ale úplná záloha — pořadí tabulek je totéž co ve staženém souboru. */
function maleZalohy() {
  return {
    format: 'testmaker-zaloha',
    verze: 1,
    vytvoreno: new Date().toISOString(),
    tabulky: {
      subjects: [{ id: IDS.subject, name: PREDMET, position: 99 }],
      grades: [{ id: IDS.grade, subjectId: IDS.subject, name: '9. ročník', position: 0 }],
      topics: [
        {
          id: IDS.topic,
          gradeId: IDS.grade,
          name: TEMA,
          position: 0,
          usableCharCount: TEXT.length,
          lowContent: false,
        },
      ],
      materials: [
        {
          id: 'e2e-zaloha-material',
          topicId: IDS.topic,
          fileName: 'obnoveny.txt',
          relativePath: `${PREDMET}/9. ročník/obnoveny.txt`,
          mimeType: 'text/plain',
          sizeBytes: TEXT.length,
          text: TEXT,
          charCount: TEXT.length,
          pageCount: null,
          needsOcr: false,
          contentHash: 'e2e-zaloha-hash',
          duplicateOfId: null,
          duplicateScore: null,
        },
      ],
      questions: [
        {
          id: IDS.question,
          topicId: IDS.topic,
          materialId: null,
          type: 'single_choice',
          payload: { prompt: 'Co se obnovilo ze zálohy?', options: ['Nic', 'Celá knihovna'], correctIndex: 1 },
          blocks: [],
          points: 1,
          difficulty: 2,
          source: 'manual',
          status: 'approved',
          searchText: 'co se obnovilo ze zálohy?',
        },
      ],
    },
  }
}

/** Soubor tak, jak ho učitelka vybere z disku. */
function soubor() {
  return {
    name: 'testmaker-zaloha-zkouska.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(maleZalohy()), 'utf8'),
  }
}

test.describe('záloha knihovny', () => {
  test.afterAll(async ({ request }) => {
    // Obnovený předmět v knihovně nenecháváme — ostatní testy počítají řádky.
    await request.delete(`/api/library?kind=subject&id=${IDS.subject}`)
  })

  test('záloha se stáhne jako jeden soubor se vším, co v knihovně je', async ({ page }) => {
    await page.goto('/zaloha')
    await expect(page.getByRole('heading', { name: 'Záloha', level: 1 })).toBeVisible()

    const stahovani = page.waitForEvent('download')
    await page.getByTestId('stahnout-zalohu').click()
    const download = await stahovani

    expect(download.suggestedFilename()).toMatch(/^testmaker-zaloha-\d{4}-\d{2}-\d{2}\.json$/)

    const cesta = await download.path()
    const { readFile } = await import('node:fs/promises')
    const zaloha = JSON.parse(await readFile(cesta, 'utf8')) as {
      format: string
      tabulky: Record<string, unknown[]>
    }

    expect(zaloha.format).toBe('testmaker-zaloha')
    // Fronta generování je pracovní stav, do zálohy nepatří.
    expect(zaloha.tabulky.generation_jobs).toBeUndefined()
    expect(zaloha.tabulky.topics.length).toBeGreaterThan(0)
    expect(zaloha.tabulky.questions.length).toBeGreaterThan(0)
  })

  test('obnova ze souboru naveze data a podruhé už nic nezdvojí', async ({ page }) => {
    await page.goto('/zaloha')

    await page.getByTestId('zaloha-soubor').setInputFiles(soubor())

    // Nejdřív se jen vypíše, co v souboru je — teprve pak se něco zapisuje.
    const potvrzeni = page.getByTestId('zaloha-potvrzeni')
    await expect(potvrzeni).toBeVisible()
    await expect(potvrzeni).toContainText('1 předmět')
    await expect(potvrzeni).toContainText('1 otázka')

    await potvrzeni.getByRole('button', { name: 'Obnovit knihovnu' }).click()
    await expect(page.getByTestId('zaloha-hotovo')).toBeVisible()
    await expect(page.getByTestId('zaloha-hotovo')).toContainText('1 otázka')

    const hledani = await page.request.get(`/api/library/search?q=${encodeURIComponent(TEMA)}`)
    const { results } = (await hledani.json()) as { results: { topicId: string }[] }
    expect(results.filter((row) => row.topicId === IDS.topic)).toHaveLength(1)

    const dopad = await page.request.get(`/api/library?kind=topic&id=${IDS.topic}`)
    expect((await dopad.json()) as { questions: number; materials: number }).toMatchObject({
      questions: 1,
      materials: 1,
    })

    // Podruhé tentýž soubor: sloučí se podle id, nic nepřibude.
    await page.getByTestId('zaloha-soubor').setInputFiles(soubor())
    // Výběrem souboru výpis z minulé obnovy zmizí, takže následující kontrola
    // opravdu čeká na druhý běh, ne na zbytek po prvním.
    await expect(page.getByTestId('zaloha-hotovo')).toBeHidden()
    await page.getByTestId('zaloha-potvrzeni').getByRole('button', { name: 'Obnovit knihovnu' }).click()
    await expect(page.getByTestId('zaloha-hotovo')).toBeVisible()
    await expect(page.getByTestId('zaloha-potvrzeni')).toBeHidden()

    const podruhe = await page.request.get(`/api/library?kind=topic&id=${IDS.topic}`)
    expect((await podruhe.json()) as { questions: number; materials: number }).toMatchObject({
      questions: 1,
      materials: 1,
    })
  })

  test('cizí soubor se odmítne srozumitelnou hláškou', async ({ page }) => {
    await page.goto('/zaloha')

    await page.getByTestId('zaloha-soubor').setInputFiles({
      name: 'rozvrh.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"rozvrh":[]}', 'utf8'),
    })

    await expect(page.getByTestId('zaloha-chyba')).toContainText('není záloha TestMakeru')
    await expect(page.getByTestId('zaloha-potvrzeni')).toBeHidden()
  })
})
