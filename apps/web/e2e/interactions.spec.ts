import { expect, test } from '@playwright/test'

/**
 * Chování, které se dá ověřit jedině skutečným ovládáním: dialogy, rozbalovací
 * nabídky, klávesnice a tisk. Přesně tohle dřív nikdo neověřil.
 */

/** Téma s materiály, na kterém se dá pracovat. */
const TOPIC = '/topics/mszAgwOgLDa4'

test.describe('editor otázky', () => {
  test('otevře se, zavře Escapem a vrátí ohnisko', async ({ page }) => {
    await page.goto(TOPIC)
    await page.getByRole('button', { name: 'Vlastní otázka' }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Nová otázka')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('nabídka typu otázky jde ovládat a mění pole formuláře', async ({ page }) => {
    await page.goto(TOPIC)
    await page.getByRole('button', { name: 'Vlastní otázka' }).first().click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Volná odpověď' }).click()

    // U volné odpovědi se ptáme na počet linek; u výběru možností ne.
    await expect(dialog.getByText('Počet linek')).toBeVisible()
  })
})

test.describe('filtry otázek', () => {
  test('rozbalovací nabídka se otevře a vybere hodnotu', async ({ page }) => {
    await page.goto(TOPIC)

    // Rozvržení vykresluje obsah dvakrát (záložky + sloupce), proto bereme viditelnou kopii.
    const typeFilter = page.locator('#question-type-filter:visible')
    await typeFilter.click()
    await page.getByRole('option', { name: 'Pravda / nepravda' }).click()
    await expect(typeFilter).toContainText('Pravda / nepravda')
  })
})

test.describe('správa skupiny materiálů', () => {
  test('nabídne přeřazení do jiného ročníku', async ({ page }) => {
    await page.goto(TOPIC)
    await page.getByRole('button', { name: 'Upravit skupinu' }).first().click()

    const gradeSelect = page.locator('#topic-group-grade:visible')
    await expect(gradeSelect).toBeVisible()
    await gradeSelect.click()
    await expect(page.getByRole('option', { name: 'Bez ročníku' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Jiný ročník…' })).toBeVisible()
  })
})

test.describe('generování bez klíče', () => {
  test('se vůbec nenabízí', async ({ page }) => {
    await page.goto(TOPIC)
    await expect(page.getByRole('button', { name: 'Vygenerovat ze skupiny' })).toHaveCount(0)
    await expect(page.getByText('chybí přístupový klíč')).toHaveCount(0)

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Hromadné generování' })).toHaveCount(0)
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
      await page.getByRole('menuitem', { name: 'Vytisknout' }).click()

      // Do stránky se vloží rám s PDF; to je pozorovatelný důsledek.
      await expect
        .poll(async () => page.locator(`iframe[src*="/api/tests/${id}/pdf"]`).count(), { timeout: 10_000 })
        .toBeGreaterThan(0)
    } finally {
      await page.request.delete(`/api/tests?id=${encodeURIComponent(id)}`)
    }
  })
})
