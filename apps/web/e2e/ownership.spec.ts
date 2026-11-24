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
        // New tests are shared with the school by default; this one is private.
        visibility: 'soukrome',
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
    await expect(pageB.getByTestId('not-found-page')).toBeVisible()

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

test('a colleague edits a test the author shared for editing', async ({ browser, baseURL }) => {
  const contextA = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  const contextB = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaB.json', baseURL })

  try {
    const bank = await contextA.request.get('/api/questions?status=approved&limit=1')
    expect(bank.ok()).toBe(true)
    const { items } = (await bank.json()) as { items: { id: string }[] }
    expect(items.length, 'the library has no approved questions').toBeGreaterThan(0)

    const name = `Písemka k úpravám ${Date.now()}`
    const creation = await contextA.request.post('/api/tests', {
      data: {
        title: name,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        visibility: 'skola',
        items: [{ kind: 'question', questionId: items[0]!.id }],
      },
    })
    expect(creation.ok()).toBe(true)
    const { id } = (await creation.json()) as { id: string }

    // The author shares it for editing in the settings and saves.
    const pageA = await contextA.newPage()
    await pageA.goto(`/tests/${id}`)
    await pageA.getByRole('button', { name: 'Nastavení testu' }).click()
    const settingsA = pageA.getByRole('dialog', { name: 'Nastavení testu' })
    await settingsA.getByRole('combobox', { name: 'Sdílení' }).click()
    await pageA.getByRole('option', { name: 'Sdílený k úpravám' }).click()
    await expect(settingsA.getByRole('combobox', { name: 'Sdílení' })).toHaveText('Sdílený k úpravám')
    await pageA.keyboard.press('Escape')
    await pageA.getByRole('button', { name: 'Uložit', exact: true }).click()
    await expect(pageA.getByTestId('toast-saved')).toBeVisible()

    // The colleague gets an editable builder with a note, but no say in sharing.
    const pageB = await contextB.newPage()
    await pageB.goto(`/tests/${id}`)
    await expect(pageB.getByTestId('colleague-edit-note')).toBeVisible()
    await pageB.getByRole('button', { name: 'Nastavení testu' }).click()
    const settingsB = pageB.getByRole('dialog', { name: 'Nastavení testu' })
    await expect(settingsB.getByRole('combobox', { name: 'Varianty' })).toBeVisible()
    await expect(settingsB.getByRole('combobox', { name: 'Sdílení' })).toHaveCount(0)
    await pageB.keyboard.press('Escape')

    const title = pageB.getByLabel('Název testu')
    await title.fill(`${name} — opraveno`)
    await pageB.getByRole('button', { name: 'Uložit', exact: true }).click()
    await expect(pageB.getByTestId('toast-saved')).toBeVisible()

    await pageB.reload()
    await expect(pageB.getByLabel('Název testu')).toHaveValue(`${name} — opraveno`)

    // The author still owns it: the change shows up for her too, and only she can delete it.
    await pageA.reload()
    await expect(pageA.getByLabel('Název testu')).toHaveValue(`${name} — opraveno`)
    expect((await contextB.request.delete(`/api/tests?id=${id}`)).status()).toBe(404)
    expect((await contextA.request.delete(`/api/tests?id=${id}`)).ok()).toBe(true)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
