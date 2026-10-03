import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The `nahled` role: reads and prints but changes nothing. The gateway stops
 * writing requests either way — this verifies the more understandable half,
 * that the UI does not offer buttons that would end in a rejection anyway.
 */
test.use({ storageState: 'e2e/.auth/nahled.json' })

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('preview browses the library but creates and deletes nothing in it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Třídy' })).toBeVisible()

  // Import, generation and the question bank are gone from the bar entirely (not only
  // for preview) — import and generation remain as pages, the bank was removed altogether.
  await expect(page.getByRole('link', { name: 'Import materiálů' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Generování', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Banka otázek' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Správa' })).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Založit předmět' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Smazat předmět/ })).toHaveCount(0)
  // Import and a new test are also changing actions — the home page does not offer
  // them to preview, although the `/import` and `/tests/new` pages themselves remain.
  await expect(page.getByRole('button', { name: 'Hromadný import' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nový test' })).toHaveCount(0)
})

test('the server rejects the write too, not just a hidden button', async ({ page }) => {
  const response = await page.request.post('/api/library', {
    data: { kind: 'subject', name: 'Náhled sem nesmí' },
  })
  expect(response.status()).toBe(403)
})

test('preview does not get into management', async ({ page }) => {
  await page.goto('/sprava')
  // The gateway sends it back to the home screen.
  await expect(page).toHaveURL(/\/$/)
})

/**
 * Questions in a topic as cards (see `topic-questions.spec.ts`): it sees the cards,
 * but no button that would change them is offered.
 *
 * A dedicated test topic for this file — a teacher creates it in her own context
 * (preview may not write itself), preview only reads the page.
 */
const TOPIC_SUBJECT = 'E2E KONTROLA'
const TOPIC_GRADE = 'E2E otázky tématu'
const TOPIC_NAME = 'Otázky v tématu jako karty'
const TOPIC_TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

async function ensureTopicQuestions(request: APIRequestContext): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${TOPIC_SUBJECT}/${TOPIC_GRADE}/${TOPIC_NAME}.txt`,
          fileName: `${TOPIC_NAME}.txt`,
          subject: TOPIC_SUBJECT,
          grade: TOPIC_GRADE,
          topic: TOPIC_NAME,
          mimeType: 'text/plain',
          sizeBytes: TOPIC_TEXT.length,
          text: TOPIC_TEXT,
          pageCount: null,
          needsOcr: false,
          contentHash: 'e2e-tema-otazky-v1',
        },
      ],
    },
  })
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC_NAME)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC_NAME))
  expect(topic, `zkušební téma „${TOPIC_NAME}“ se v knihovně nenašlo`).toBeTruthy()
  return topic!.topicId
}

test('preview sees question cards in a topic but no button that would change them', async ({
  page,
  browser,
  baseURL,
}) => {
  // Preview may not write itself — a teacher creates the topic and question for it
  // in her own context, preview then only opens the page to read.
  const writer = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  let topicId: string
  try {
    topicId = await ensureTopicQuestions(writer.request)
    const created = await writer.request.post('/api/questions', {
      data: {
        topicId,
        question: {
          type: 'short_answer',
          difficulty: 1,
          points: 1,
          blocks: [],
          payload: { prompt: `Otázka pro náhled ${Date.now()}`, answer: 'odpověď', acceptedAnswers: [] },
        },
      },
    })
    expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  } finally {
    await writer.close()
  }

  await page.goto(`/topics/${topicId}`)

  // `exact: true` matters here: "Upravit téma" and "Smazat téma" would otherwise
  // satisfy a substring search for "Upravit"/"Smazat" and the test would silently
  // pass even if the card really offered its button.
  await expect(page.locator('li[data-question-id]').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nová otázka', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upravit', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Smazat', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Přegenerovat', exact: true })).toHaveCount(0)
  // The arrow next to "Přegenerovat" also carries "Lehčí verze"/"Těžší verze" — the
  // whole menu is gone, so preview has nowhere to start creating variants from.
  await expect(page.getByRole('button', { name: 'Přegenerovat s důvodem' })).toHaveCount(0)

  // The "Vybrat do testu" checkbox and the selection bar are also changing actions —
  // preview adds nothing to the bank and has no way to select questions in it.
  await expect(page.getByRole('checkbox', { name: 'Vybrat do testu' })).toHaveCount(0)
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)

  // The "Smazané" toggle leads to restoring a question — also a changing action
  // preview does not have.
  await expect(page.getByRole('button', { name: /^Smazané \(\d+\)$/ })).toHaveCount(0)
})

/**
 * The grade page (see `grades.spec.ts`): preview sees the topics, but no button
 * that would change the grade or its topics.
 *
 * A dedicated test grade for this test — a teacher creates it in her own context,
 * preview only reads the page.
 */
test('preview sees the topics of a grade but no button that would change it', async ({
  page,
  browser,
  baseURL,
}) => {
  const writer = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  let gradeId: string
  let gradeName: string
  try {
    const subject = await writer.request.post('/api/library', {
      data: { kind: 'subject', name: `E2E NAHLED TRIDA ${Date.now()}` },
    })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }

    gradeName = `Náhledový ročník ${Date.now()}`
    const grade = await writer.request.post('/api/library', {
      data: { kind: 'grade', name: gradeName, parentId: subjectId },
    })
    expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
    gradeId = (await grade.json()).id as string

    const topic = await writer.request.post('/api/library', {
      data: { kind: 'topic', name: 'Téma pro náhled', parentId: gradeId },
    })
    expect(topic.ok(), 'zkušební téma se nepodařilo založit').toBe(true)
  } finally {
    await writer.close()
  }

  await page.goto(`/tridy/${gradeId}`)
  await expect(page.getByRole('heading', { name: gradeName, exact: true })).toBeVisible()
  // The topic is now visible twice — in the middle column and on a tile in the
  // content — so the search is limited to the content area.
  const content = page.getByRole('region', { name: 'Obsah třídy' })
  await expect(content.getByText('Téma pro náhled', { exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Přidat téma' })).toHaveCount(0)
  await expect(page.getByLabel('Přesunout téma do jiného ročníku')).toHaveCount(0)
  // "Vygenerovat pro celou třídu" is a button label only inside the bulk generation
  // panel — the whole panel and its trigger disappear together.
  await expect(page.getByRole('button', { name: 'Hromadné generování' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Přejmenovat/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Smazat ročník' })).toHaveCount(0)
})

/**
 * The materials strip (see `topic-materials.spec.ts`): preview sees it, but without
 * uploading, the "Použít pro generování" toggle, deleting and "Upravit téma" —
 * all changing actions the gateway would reject anyway.
 */
test('preview sees the materials strip without uploading, toggle and deleting', async ({ page, browser, baseURL }) => {
  // Preview may not write itself — a teacher creates the topic for it in her own
  // context, preview then only opens the page to read.
  const writer = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  let topicId: string
  try {
    topicId = await ensureTopicQuestions(writer.request)
  } finally {
    await writer.close()
  }

  await page.goto(`/topics/${topicId}`)
  await page.getByRole('button', { name: /^Materiály/ }).click()

  await expect(page.getByText(`${TOPIC_NAME}.txt`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nahrát materiály' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Použít pro generování/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Smazat', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upravit téma', exact: true })).toHaveCount(0)
})

/**
 * Deleting in the library (`DELETE /api/library`): a teacher deletes topics too —
 * she works with a topic as a whole, from creating it to deleting it. Subjects and
 * grades, under which lies the whole school's work, only a manager; the
 * "Smazat ročník"/"Smazat předmět" buttons are therefore not offered to her at
 * all, otherwise she would hit a 403 (see `DeleteFromLibrary`).
 */
test.describe('a teacher deletes topics, but not subjects or grades', () => {
  test.use({ storageState: 'e2e/.auth/ucitelkaA.json' })

  test('a teacher creates a topic, renames it and deletes it', async ({ page, request }) => {
    const subject = await request.post('/api/library', {
      data: { kind: 'subject', name: `E2E UCITELKA TEMA ${Date.now()}` },
    })
    expect(subject.ok(), 'could not create the test subject').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }
    const grade = await request.post('/api/library', {
      data: { kind: 'grade', name: `Ročník pro téma ${Date.now()}`, parentId: subjectId },
    })
    expect(grade.ok(), 'could not create the test grade').toBe(true)
    const { id: gradeId } = (await grade.json()) as { id: string }

    const topic = await request.post('/api/library', {
      data: { kind: 'topic', name: 'Učitelčino téma', parentId: gradeId },
    })
    expect(topic.ok(), 'the teacher did not create the topic').toBe(true)
    const { id: topicId } = (await topic.json()) as { id: string }

    const renamed = await request.patch('/api/library', {
      data: { kind: 'topic', id: topicId, name: 'Učitelčino téma přejmenované' },
    })
    expect(renamed.ok(), 'the teacher did not rename the topic').toBe(true)

    await page.goto(`/topics/${topicId}`)
    await expect(page.getByRole('heading', { name: 'Učitelčino téma přejmenované' })).toBeVisible()
    await page.getByRole('button', { name: 'Smazat téma' }).first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page).not.toHaveURL(new RegExp(topicId))

    const gone = await request.get(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
    expect(gone.status()).toBe(404)

    // She may delete neither the grade nor the subject — not even straight via the API.
    const gradeDelete = await request.delete(`/api/library?kind=grade&id=${encodeURIComponent(gradeId)}`)
    expect(gradeDelete.status()).toBe(403)
    const subjectDelete = await request.delete(`/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`)
    expect(subjectDelete.status()).toBe(403)
  })

  test('the grade page does not offer Smazat ročník to a teacher', async ({ page, request }) => {
    const subject = await request.post('/api/library', {
      data: { kind: 'subject', name: `E2E UCITELKA MAZANI ${Date.now()}` },
    })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }

    const gradeName = `Ucitelčin ročník ${Date.now()}`
    const grade = await request.post('/api/library', {
      data: { kind: 'grade', name: gradeName, parentId: subjectId },
    })
    expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
    const { id: gradeId } = (await grade.json()) as { id: string }

    await page.goto(`/tridy/${gradeId}`)
    await expect(page.getByRole('heading', { name: gradeName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Smazat ročník' })).toHaveCount(0)
    // Other changing actions (renaming, adding a topic) stay available to her.
    await expect(page.getByRole('button', { name: 'Přidat téma' })).toBeVisible()
  })

  test('the home page does not offer Smazat předmět to a teacher', async ({ page, request }) => {
    const subjectName = `E2E UCITELKA PREDMET ${Date.now()}`
    const subject = await request.post('/api/library', { data: { kind: 'subject', name: subjectName } })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)

    await page.goto('/?vse=1')
    // The subject name is now visible in the side panel too — so the search is
    // limited to the content area, where it is a section heading.
    await expect(page.getByRole('heading', { name: subjectName })).toBeVisible()
    await expect(page.getByRole('button', { name: /Smazat předmět/ })).toHaveCount(0)
    // Renaming and adding a grade stay available to the teacher — only deleting is gone.
    await expect(page.getByRole('button', { name: /Založit předmět/ })).toBeVisible()
  })
})
