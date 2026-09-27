import { expect, test } from '@playwright/test'

/**
 * Písemka patří své autorce. Kolegyně ji nesmí vidět v seznamu, otevřít na
 * přímé adrese ani vytisknout — na to, aby se dala uhodnout, stačí jedno id.
 */
test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('cizí písemka není v seznamu, na adrese ani v PDF', async ({ browser, baseURL }) => {
  const kontextA = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  const kontextB = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaB.json', baseURL })

  try {
    const nazev = `Písemka učitelky A ${Date.now()}`
    const sablony = await kontextA.request.get('/api/tests')
    expect(sablony.ok()).toBe(true)

    // Písemku zakládáme přes API: skládání v prohlížeči má vlastní testy,
    // tady jde o to, kdo ji pak uvidí.
    const zalozeni = await kontextA.request.post('/api/tests', {
      data: {
        title: nazev,
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        showKey: true,
        items: [],
      },
    })
    expect(zalozeni.ok()).toBe(true)
    const { id } = (await zalozeni.json()) as { id: string }

    // Autorka ji vidí.
    const strankaA = await kontextA.newPage()
    await strankaA.goto('/tests')
    await expect(strankaA.getByText(nazev)).toBeVisible()

    // Kolegyně ne — ani v seznamu, ani na přímé adrese.
    const strankaB = await kontextB.newPage()
    await strankaB.goto('/tests')
    await expect(strankaB.getByText(nazev)).toHaveCount(0)
    await strankaB.goto(`/tests/${id}`)
    await expect(strankaB.getByText(/Stránka neexistuje|Stránka nenalezena|404/i).first()).toBeVisible()

    // A nedostane ani PDF, i když si adresu složí sama.
    const pdf = await kontextB.request.get(`/api/tests/${id}/pdf`)
    expect(pdf.status()).toBe(404)
  } finally {
    await kontextA.close()
    await kontextB.close()
  }
})

test('nasdílenou písemku kolegyně otevře, ale neuloží', async ({ browser, baseURL }) => {
  const kontextA = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  const kontextB = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaB.json', baseURL })

  try {
    const nazev = `Sdílená písemka ${Date.now()}`
    const zalozeni = await kontextA.request.post('/api/tests', {
      data: {
        title: nazev,
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
    const { id } = (await zalozeni.json()) as { id: string }

    // Kolegyně ji vidí i vytiskne.
    const strankaB = await kontextB.newPage()
    await strankaB.goto('/tests')
    await expect(strankaB.getByText(nazev)).toBeVisible()
    expect((await kontextB.request.get(`/api/tests/${id}/pdf`)).status()).toBe(200)

    // Přepsat ji ale nesmí — sdílení je ke čtení, ne ke spoluautorství.
    const prepis = await kontextB.request.put('/api/tests', {
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
    expect(prepis.status()).toBe(404)
  } finally {
    await kontextA.close()
    await kontextB.close()
  }
})
