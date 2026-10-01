import { expect, test } from '@playwright/test'

/**
 * Library backup in the browser: downloading the whole file and restoring from it.
 *
 * Exactly these two cannot be checked elsewhere — downloading goes through
 * the `content-disposition` header and restoring through a file picker, and
 * both behave a bit differently in each browser. The restore deliberately
 * runs twice: the second run must duplicate nothing.
 */

/** Own subject, so other tests' data does not get in this test's way. */
const SUBJECT = 'E2E ZÁLOHA'
const TOPIC = 'Obnovené téma'

const IDS = {
  subject: 'e2e-zaloha-predmet',
  grade: 'e2e-zaloha-rocnik',
  topic: 'e2e-zaloha-tema',
  question: 'e2e-zaloha-otazka',
}

const TEXT = 'Obnovený materiál k tématu. '.repeat(20)

/** A small but complete backup — the table order is the same as in a downloaded file. */
function smallBackups() {
  return {
    format: 'testmaker-zaloha',
    verze: 1,
    vytvoreno: new Date().toISOString(),
    tabulky: {
      subjects: [{ id: IDS.subject, name: SUBJECT, position: 99 }],
      grades: [{ id: IDS.grade, subjectId: IDS.subject, name: '9. ročník', position: 0 }],
      topics: [
        {
          id: IDS.topic,
          gradeId: IDS.grade,
          name: TOPIC,
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
          relativePath: `${SUBJECT}/9. ročník/obnoveny.txt`,
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

/** The file as the teacher picks it from disk. */
function file() {
  return {
    name: 'testmaker-zaloha-zkouska.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(smallBackups()), 'utf8'),
  }
}

test.describe('library backup', () => {
  test.afterAll(async ({ request }) => {
    // We don't leave the restored subject in the library — other tests count rows.
    await request.delete(`/api/library?kind=subject&id=${IDS.subject}`)
  })

  test('the backup downloads as one file with everything in the library', async ({ page }) => {
    await page.goto('/zaloha')
    await expect(page.getByRole('heading', { name: 'Záloha', level: 1 })).toBeVisible()

    const downloading = page.waitForEvent('download')
    await page.getByTestId('stahnout-zalohu').click()
    const download = await downloading

    expect(download.suggestedFilename()).toMatch(/^testmaker-zaloha-\d{4}-\d{2}-\d{2}\.json$/)

    const filePath = await download.path()
    const { readFile } = await import('node:fs/promises')
    const backup = JSON.parse(await readFile(filePath, 'utf8')) as {
      format: string
      tabulky: Record<string, unknown[]>
    }

    expect(backup.format).toBe('testmaker-zaloha')
    // The generation queue is working state and does not belong in the backup.
    expect(backup.tabulky.generation_jobs).toBeUndefined()
    expect(backup.tabulky.topics.length).toBeGreaterThan(0)
    expect(backup.tabulky.questions.length).toBeGreaterThan(0)
  })

  test('restoring from a file loads the data and duplicates nothing the second time', async ({ page }) => {
    await page.goto('/zaloha')

    await page.getByTestId('zaloha-soubor').setInputFiles(file())

    // First the file's contents are only listed — only then is anything written.
    const confirmation = page.getByTestId('zaloha-potvrzeni')
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('1 předmět')
    await expect(confirmation).toContainText('1 otázka')

    await confirmation.getByRole('button', { name: 'Obnovit knihovnu' }).click()
    await expect(page.getByTestId('zaloha-hotovo')).toBeVisible()
    await expect(page.getByTestId('zaloha-hotovo')).toContainText('1 otázka')

    const search = await page.request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
    const { results } = (await search.json()) as { results: { topicId: string }[] }
    expect(results.filter((row) => row.topicId === IDS.topic)).toHaveLength(1)

    const impact = await page.request.get(`/api/library?kind=topic&id=${IDS.topic}`)
    expect((await impact.json()) as { questions: number; materials: number }).toMatchObject({
      questions: 1,
      materials: 1,
    })

    // The same file again: it merges by id, nothing is added.
    await page.getByTestId('zaloha-soubor').setInputFiles(file())
    // Picking a file clears the previous restore's summary, so the following
    // check really waits for the second run, not leftovers of the first.
    await expect(page.getByTestId('zaloha-hotovo')).toBeHidden()
    await page.getByTestId('zaloha-potvrzeni').getByRole('button', { name: 'Obnovit knihovnu' }).click()
    await expect(page.getByTestId('zaloha-hotovo')).toBeVisible()
    await expect(page.getByTestId('zaloha-potvrzeni')).toBeHidden()

    const secondTime = await page.request.get(`/api/library?kind=topic&id=${IDS.topic}`)
    expect((await secondTime.json()) as { questions: number; materials: number }).toMatchObject({
      questions: 1,
      materials: 1,
    })
  })

  test('a foreign file is rejected with a clear message', async ({ page }) => {
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
