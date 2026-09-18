import { expect, test, type Page } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Průběh generování na obrazovce tématu.
 *
 * Model se v testu nikdy nevolá: volání `/api/generate` se v prohlížeči
 * nahradí vlastním proudem událostí, který posílá totéž, co posílá server —
 * jen s pevným obsahem a v tempu, ve kterém se dá průběh sledovat.
 *
 * Jde o to, co učitelka vidí za běhu: kolik otázek už vzniklo a že se objevují
 * v seznamu hned, ne až na konci.
 */

const PRVNI = 'Kde probíhá fotosyntéza — zkušební otázka?'
const DRUHA = 'Co při fotosyntéze vzniká — zkušební otázka?'

/** Podvržený proud událostí generování. `krok` je pauza mezi událostmi. */
async function stubGenerating(page: Page, krok = 400): Promise<void> {
  await page.addInitScript(
    ({ krok, prvni, druha }) => {
      const otazka = (id: string, prompt: string) => ({
        id,
        topicId: 'zkouska',
        materialId: null,
        source: 'ai',
        status: 'draft',
        createdAt: new Date().toISOString(),
        type: 'single_choice',
        payload: { prompt, options: ['V kořenech', 'V listech'], correctIndex: 1 },
        blocks: [],
        points: 1,
        difficulty: 2,
      })

      const events = [
        { type: 'start' },
        { type: 'saved', created: 1, questions: [otazka('zkouska-1', prvni)] },
        { type: 'progress', done: 1, total: 2 },
        { type: 'saved', created: 2, questions: [otazka('zkouska-2', druha)] },
        { type: 'done', created: 2, rejected: 1, failedCalls: 0, topicId: 'zkouska', sources: 1, models: ['zkouska'] },
      ]

      const puvodni = window.fetch.bind(window)
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!url.includes('/api/generate')) return puvodni(input, init)

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            let index = 0
            const push = () => {
              if (index >= events.length) {
                controller.close()
                return
              }
              controller.enqueue(encoder.encode(`${JSON.stringify(events[index++])}\n`))
              setTimeout(push, krok)
            }
            setTimeout(push, krok)
          },
        })
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
          }),
        )
      }
    },
    { krok, prvni: PRVNI, druha: DRUHA },
  )
}

/** Spustí generování na stránce tématu. Vrací se, až se tlačítko chytne. */
async function spustit(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /generovat otázky$/ })
  await expect(button).toBeEnabled()
  await button.click()
}

test.describe('průběh generování u tématu', () => {
  test('hlásí, kolik otázek už vzniklo, a rovnou je ukazuje v seznamu', async ({ page, request }) => {
    const path = await testTopicPath(request)
    // Tempo je schválně pomalé: mezistav („hotová první dávka“) se má dát
    // spolehlivě zahlédnout i na pomalejším prohlížeči.
    await stubGenerating(page, 1000)
    await page.goto(path)

    const generate = page.getByRole('button', { name: /generovat otázky$/ })
    test.skip((await generate.count()) === 0, 'Generování není nakonfigurované.')
    await spustit(page)

    // Než přijde první dávka, je vidět aspoň to, že se začalo.
    await expect(page.getByText(/Spouštím generování|Zatím žádná otázka není hotová/)).toBeVisible()

    // První uložená dávka: počet i samotná otázka, ještě za běhu.
    await expect(page.getByText('Hotovo 1 otázka')).toBeVisible()
    await expect(page.getByText(PRVNI)).toBeVisible()

    // Druhá dávka přibude k ní — seznam roste, nečeká se na konec.
    await expect(page.getByText(/Hotovo 2 otázky/)).toBeVisible()
    await expect(page.getByText(DRUHA)).toBeVisible()

    // Konec řekne, co vzniklo a co se zahodilo — jednou, v kartě. Bublina
    // jen upozorní, že je hotovo.
    await expect(page.getByText(/Vytvořeno 2 otázky/)).toHaveCount(1)
    await expect(page.getByText('Zahozeno: 1 otázka — neúplné nebo si odporovaly.')).toBeVisible()
    await expect(page.getByText('Hotovo, 2 otázky ke kontrole.')).toBeVisible()
    const odkaz = page.getByRole('link', { name: 'Zkontrolovat' })
    await expect(odkaz).toBeVisible()
    await odkaz.click()
    await expect(page).toHaveURL(/\/review\?topicId=/)
  })

  test('průběh je čitelný ve světlém i tmavém režimu', async ({ page, request }) => {
    const path = await testTopicPath(request)
    // Pomalejší tempo, ať se stihne snímek uprostřed práce.
    await stubGenerating(page, 1200)
    await page.goto(path)

    const generate = page.getByRole('button', { name: /generovat otázky$/ })
    test.skip((await generate.count()) === 0, 'Generování není nakonfigurované.')

    for (const motiv of ['svetla', 'tmava'] as const) {
      if (motiv === 'tmava') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }

      await spustit(page)
      await expect(page.getByText('Hotovo 1 otázka')).toBeVisible()
      await expect(page.getByText(PRVNI)).toBeVisible()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.screenshot({
        path: `e2e/screenshots/prubeh-generovani-${motiv}-1440.png`,
        fullPage: false,
      })

      // Doběhnout to musí celé, jinak by druhý průchod začínal doprostřed.
      await expect(page.getByRole('link', { name: 'Zkontrolovat' })).toBeVisible()
      // Stav po doběhnutí: souhrn běhu je v kartě jednou, bublina jen hlásí hotovo.
      await page.screenshot({ path: `e2e/screenshots/tema-pote-${motiv}-1440.png`, fullPage: false })

      // Úzká obrazovka až nakonec: zúžení okna pracovní plochu tématu přemontuje
      // (rozvržení se pod `sm` skládá jinak) a souhrn běhu se z ní ztratí.
      await page.setViewportSize({ width: 390, height: 900 })
      await page.screenshot({
        path: `e2e/screenshots/prubeh-generovani-${motiv}-390.png`,
        fullPage: false,
      })
      await page.setViewportSize({ width: 1440, height: 900 })
    }

    // Motiv se vrátí zpátky, ať další test nezačíná potmě.
    await page.getByRole('button', { name: 'Podle systému' }).click()
  })
})
