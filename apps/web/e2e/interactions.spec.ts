import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Chování, které se dá ověřit jedině skutečným ovládáním: dialogy, rozbalovací
 * nabídky, klávesnice a tisk. Přesně tohle dřív nikdo neověřil.
 */

// Téma, na kterém se dá pracovat, si každý test najde sám přes `testTopicPath`
// — natvrdo zadané id z autorova disku by na cizí databázi neexistovalo.

test.describe('editor otázky', () => {
  // Bance otázek, kde se dřív editace otevírala jako dialog z nabídky u řádku
  // (Escape zavře, ohnisko se vrátí na spouštěč), se zrušila docela — v tématu
  // se otázka upravuje přímo v kartě, bez dialogu, takže tenhle scénář nemá
  // kde běžet dál.

  test('nabídka typu otázky jde ovládat a mění pole formuláře', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))
    await page.getByRole('button', { name: 'Nová otázka' }).click()

    const form = page.getByTestId('new-question-form')
    await form.getByLabel('Typ').click()
    await page.getByRole('option', { name: 'Volná odpověď' }).click()

    // U volné odpovědi se ptáme na počet linek; u výběru možností ne.
    await expect(form.getByText('Počet linek')).toBeVisible()
  })
})

test.describe('filtry otázek', () => {
  test('rozbalovací nabídka se otevře a vybere hodnotu', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))

    const typeFilter = page.getByLabel('Typ')
    await typeFilter.click()
    await page.getByRole('option', { name: 'Pravda / nepravda' }).click()
    await expect(typeFilter).toContainText('Pravda / nepravda')
  })
})

test.describe('správa materiálů tématu', () => {
  test('nabídne přeřazení do jiného ročníku', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))
    await page.getByRole('button', { name: 'Upravit téma' }).click()

    // Přesně „Ročník" — postranní panely mají v názvu „ročníky" a „ročníku".
    const gradeSelect = page.getByLabel('Ročník', { exact: true })
    await expect(gradeSelect).toBeVisible()
    await gradeSelect.click()
    await expect(page.getByRole('option', { name: 'Bez ročníku' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Jiný ročník…' })).toBeVisible()
  })
})

test.describe('nabídka generování', () => {
  test('se řídí tím, jestli je klíč k modelu', async ({ page, request }) => {
    // Vývojář může mít klíč vyplněný, nebo ne — test proto nejdřív zjistí stav
    // od aplikace. Bez klíče route odpoví 503, s klíčem se zastaví až na
    // neplatných datech (400).
    const probe = await request.post('/api/generate', { data: {}, failOnStatusCode: false })
    const configured = probe.status() !== 503

    // Popisek se liší podle toho, jestli téma otázky už má („Dogenerovat").
    const topicButton = page.getByRole('button', { name: /generovat otázky$/i })
    const bulkButton = page.getByRole('button', { name: 'Hromadné generování' })

    await page.goto(await testTopicPath(page.request))
    if (configured) await expect(topicButton).toBeVisible()
    else {
      await expect(topicButton).toHaveCount(0)
      // Bez klíče se nenabízí ani vysvětlující hláška u tématu — generování
      // prostě není vidět.
      await expect(page.getByText('chybí přístupový klíč')).toHaveCount(0)
    }

    // `?vse=1`: test před tím otevřel téma, takže by se `/` jinak tiše
    // přesměroval na jeho třídu místo úvodu s dlaždicemi.
    await page.goto('/?vse=1')
    if (configured) await expect(bulkButton).toBeVisible()
    else await expect(bulkButton).toHaveCount(0)
  })
})

test.describe('tisk testu', () => {
  test('tlačítko vloží PDF do stránky a vyvolá tisk', async ({ page }) => {
    // Připravíme test s jednou položkou přes API, ať je co tisknout.
    const created = await page.request.post('/api/tests', {
      data: {
        title: 'Zkouška tisku',
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        showKey: false,
        items: [{ kind: 'heading', questionId: null, text: 'Část A', pointsOverride: null }],
      },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }

    try {
      await page.goto('/tests')
      await page.getByRole('button', { name: 'Akce' }).first().click()
      await page.getByRole('menuitem', { name: 'Vytisknout zadání pro žáky' }).click()

      // Do stránky se vloží rám s PDF; to je pozorovatelný důsledek.
      await expect
        .poll(async () => page.locator(`iframe[src*="/api/tests/${id}/pdf"]`).count(), { timeout: 10_000 })
        .toBeGreaterThan(0)
    } finally {
      await page.request.delete(`/api/tests?id=${encodeURIComponent(id)}`)
    }
  })
})
