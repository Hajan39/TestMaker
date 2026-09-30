import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Upozornění na chudá témata: pod `MIN_USABLE_TOPIC_CHARS` znaků použitelného
 * textu (bez duplicit) na písemku spolehlivě nevystačí. Aplikace to má klidně,
 * ne poplašně, naznačit v dlaždici i v detailu tématu. Test si zakládá vlastní
 * téma s krátkým materiálem, aby nezávisel na tom, které skutečné téma je
 * zrovna chudé.
 */

async function createLowContentTopic(request: APIRequestContext) {
  const response = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: 'PODKLADY/9. ročník/Chudé téma.txt',
          fileName: 'Chudé téma.txt',
          subject: 'PODKLADY',
          grade: '9. ročník',
          topic: 'Chudé téma',
          mimeType: 'text/plain',
          sizeBytes: 40,
          // Výrazně pod MIN_USABLE_TOPIC_CHARS (1000 znaků).
          text: 'Pár vět jen pro ověření upozornění na málo textu.',
          pageCount: null,
          needsOcr: false,
          contentHash: `podklady-low-${Date.now()}`,
        },
      ],
    },
  })
  expect(response.ok()).toBe(true)
}

test.describe('upozornění na chudé téma', () => {
  test('dlaždice i detail tématu naznačí, že materiálů je málo', async ({ page }) => {
    await createLowContentTopic(page.request)

    // `?vse=1` u každé návštěvy úvodu: test tématum jinak jinou z jejich
    // tříd navštíví (píše se do prohlížeče jako naposledy otevřená) a další
    // `/` by na ni tiše přesměroval, místo aby ukázal dlaždice.
    //
    // Přes hledání v knihovně dojdeme rovnou do detailu nově vzniklého tématu.
    // `fill()` ve WebKitu nevyvolá u tohohle pole React onChange, proto se
    // hledaný výraz píše po znacích jako od učitelky.
    await page.goto('/?vse=1')
    await page.getByPlaceholder('Hledat v celé knihovně…').pressSequentially('Chudé téma')
    const result = page.getByRole('button', { name: /Chudé téma/ })
    await expect(result).toBeVisible()
    await result.click()

    // Detail tématu vysvětlí, co málo textu znamená, a generování nechá možné.
    await expect(page.getByRole('heading', { name: 'Chudé téma' })).toBeVisible()
    await expect(page.getByText('Materiálů je v tomhle tématu málo')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generovat otázky' })).toBeVisible()

    // A tatáž klidná poznámka je vidět na dlaždici v přehledu ročníku.
    await page.goto('/?vse=1')
    // Ročník se hledá v sekci vlastního předmětu — „první 9. ročník na stránce"
    // by se trefil do cizího předmětu, jakmile je v knihovně něco dalšího.
    const podkladyOverview = page
      .locator('section', { has: page.getByRole('heading', { name: 'PODKLADY', exact: true }) })
      .last()
    await podkladyOverview.getByRole('link', { name: '9. ročník' }).first().click()
    await expect(page.getByText('málo textu', { exact: true }).first()).toBeVisible()

    // Uklidit po sobě — test si založil vlastní předmět, do skutečné knihovny nepatří.
    await page.goto('/?vse=1')
    const podkladySection = page
      .locator('section', { has: page.locator('h2', { hasText: 'PODKLADY' }) })
      .last()
    await expect(podkladySection).toBeVisible()
    await podkladySection.getByRole('button', { name: 'Smazat předmět' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page.locator('h2', { hasText: 'PODKLADY' })).toHaveCount(0)
  })
})

/**
 * Tentýž soubor patří někdy do dvou témat — pracovní list se probírá v sedmém
 * i osmém ročníku. Knihovna ho proto nesmí napodruhé tiše spolknout jako
 * duplicitu: musí být vidět v obou tématech.
 */
test.describe('stejný soubor ve dvou tématech', () => {
  test('list naimportovaný do dvou ročníků je vidět v obou', async ({ page }) => {
    const hash = `podklady-sdileny-${Date.now()}`
    const fileName = 'Sdílený pracovní list.txt'
    const text = 'Opakování na pracovním listu. '.repeat(50)

    const response = await page.request.post('/api/materials', {
      data: {
        materials: ['7. ročník', '8. ročník'].map((grade) => ({
          relativePath: `PODKLADY/${grade}/Sdílené téma/${fileName}`,
          fileName,
          subject: 'PODKLADY',
          grade,
          topic: 'Sdílené téma',
          mimeType: 'text/plain',
          sizeBytes: text.length,
          text,
          pageCount: null,
          needsOcr: false,
          // Tentýž obsah, tedy i tentýž otisk — a přesto dva materiály.
          contentHash: hash,
        })),
      },
    })
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ imported: 2, duplicates: 0 })

    // Obě témata jsou k nalezení a v obou je soubor vidět jako plnohodnotný
    // materiál, ne jako odložená duplicita.
    for (const grade of ['7. ročník', '8. ročník']) {
      await page.goto('/?vse=1')
      const search = page.getByPlaceholder('Hledat v celé knihovně…')
      const result = page.getByRole('button', { name: new RegExp(`Sdílené téma.*${grade}`, 's') })
      // Znaky napsané před hydratací stránky React zahodí; psaní se proto
      // opakuje, dokud se výsledek neukáže.
      await expect(async () => {
        await search.clear()
        await search.pressSequentially('Sdílené téma')
        await expect(result).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await result.click()

      await expect(page.getByRole('heading', { name: 'Sdílené téma' })).toBeVisible()
      // Seznam materiálů je sbalený; v hlavičce je rozbalovací tlačítko.
      // Seznam materiálů je sbalený, název souboru je vidět až po rozbalení.
      await page.getByRole('button', { name: /^Materiály/ }).click()
      await expect(page.getByText(fileName).first()).toBeVisible()
      await expect(page.getByText('stejný obsah jako')).toHaveCount(0)
      await expect(page.getByText('Materiálů je v tomhle tématu málo')).toHaveCount(0)
    }

    // Uklidit po sobě — testovací předmět do skutečné knihovny nepatří.
    await page.goto('/?vse=1')
    const podkladySection = page
      .locator('section', { has: page.locator('h2', { hasText: 'PODKLADY' }) })
      .last()
    await expect(podkladySection).toBeVisible()
    await podkladySection.getByRole('button', { name: 'Smazat předmět' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page.locator('h2', { hasText: 'PODKLADY' })).toHaveCount(0)
  })
})
