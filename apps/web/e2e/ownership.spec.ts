import { expect, test } from '@playwright/test'

/**
 * A test belongs to its author. A colleague must not see it in the list, open
 * it at its direct URL or print it — a single id is enough to guess it.
 */
test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('someone else\'s test is not in the list, at its URL or in the PDF', async ({ browser, baseURL }) => {
  const contextA = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  const contextB = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaB.json', baseURL })

  try {
    const name = `Písemka učitelky A ${Date.now()}`
    const templates = await contextA.request.get('/api/tests')
    expect(templates.ok()).toBe(true)

    // The test is created via the API: building in the browser has its own tests,
    // here it is about who sees it afterwards.
    const creation = await contextA.request.post('/api/tests', {
      data: {
        title: name,
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        showKey: true,
        items: [],
      },
    })
    expect(creation.ok()).toBe(true)
    const { id } = (await creation.json()) as { id: string }

    // The author sees it.
    const pageA = await contextA.newPage()
    await pageA.goto('/tests')
    await expect(pageA.getByText(name)).toBeVisible()

    // The colleague does not — neither in the list nor at the direct URL.
    const pageB = await contextB.newPage()
    await pageB.goto('/tests')
    await expect(pageB.getByText(name)).toHaveCount(0)
    await pageB.goto(`/tests/${id}`)
    await expect(pageB.getByText(/Stránka neexistuje|Stránka nenalezena|404/i).first()).toBeVisible()

    // Nor does she get the PDF, even when she builds the URL herself.
    const pdf = await contextB.request.get(`/api/tests/${id}/pdf`)
    expect(pdf.status()).toBe(404)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('a colleague opens a shared test but cannot save it', async ({ browser, baseURL }) => {
  const contextA = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  const contextB = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaB.json', baseURL })

  try {
    const name = `Sdílená písemka ${Date.now()}`
    const creation = await contextA.request.post('/api/tests', {
      data: {
        title: name,
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        showKey: true,
        visibility: 'skola',
        items: [],
      },
    })
    const { id } = (await creation.json()) as { id: string }

    // The colleague sees and prints it.
    const pageB = await contextB.newPage()
    await pageB.goto('/tests')
    await expect(pageB.getByText(name)).toBeVisible()
    expect((await contextB.request.get(`/api/tests/${id}/pdf`)).status()).toBe(200)

    // But she must not overwrite it — sharing is for reading, not co-authoring.
    const overwrite = await contextB.request.put('/api/tests', {
      data: {
        id,
        title: 'Přepsáno kolegyní',
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        showKey: true,
        visibility: 'skola',
        items: [],
      },
    })
    expect(overwrite.status()).toBe(404)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
