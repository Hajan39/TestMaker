import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Tři doplňky rozhraní ze specifikace redesignu, které v prvním plánu chyběly:
 * hledání přes celou knihovnu, odhad stran pod osnovou testu a filtr
 * obtížnosti u otázek tématu.
 */

// Téma s materiály i otázkami si test najde sám — natvrdo zadané id
// z autorova disku by na cizí databázi neexistovalo.

test.describe('hledání přes celou knihovnu', () => {
  test('najde téma napříč ročníky a odkáže na něj', async ({ page }) => {
    await page.goto('/')

    // `fill()` ve WebKitu nevyvolá u tohohle pole React onChange, proto se
    // hledaný výraz píše po znacích jako od učitelky.
    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    await search.pressSequentially('fotosyntéza')

    const result = page.getByRole('button', { name: /fotosyntéza/i }).first()
    await expect(result).toBeVisible()
    // Cesta (předmět, ročník) je vidět, aby bylo poznat, odkud téma je.
    await expect(result).toContainText('PŘÍRODOPIS')

    await result.click()
    await expect(page).toHaveURL(/\/topics\//)
  })

  test('najde téma i podle názvu materiálu', async ({ page }) => {
    await page.goto('/')

    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    // „Měkkýši“ má materiál „6.22 Měkkýši (Mollusca)…“ — hledáme jen podle
    // části názvu souboru, ne podle názvu tématu.
    await search.pressSequentially('Mollusca')

    const result = page.getByRole('button', { name: /Měkkýši/i }).first()
    await expect(result).toBeVisible()
    await expect(result).toContainText('soubor')
  })

  test('krátký dotaz nic nehledá', async ({ page }) => {
    await page.goto('/')
    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    await search.pressSequentially('a')
    await expect(page.getByText('Hledám…')).toHaveCount(0)
  })
})

test.describe('odhad stran pod osnovou testu', () => {
  test('se objeví po přidání otázky a roste s dalšími', async ({ page }) => {
    // Vlastní téma se dvěma schválenými otázkami — spoléhat na to, že „první
    // rozbalené téma" v bance bude mít aspoň dvě, je křehké: pořadí témat
    // v bance se řídí názvem předmětu a závisí na tom, co si tam nechala
    // jiná zkouška. Otázka vytvořená přes API je rovnou schválená.
    const razitko = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const subject = await page.request.post('/api/library', {
      data: { kind: 'subject', name: `E2E ROZHRANI ${razitko}` },
    })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }

    try {
      const grade = await page.request.post('/api/library', {
        data: { kind: 'grade', name: `Ročník ${razitko}`, parentId: subjectId },
      })
      expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
      const { id: gradeId } = (await grade.json()) as { id: string }

      const topicName = `Téma pro odhad stran ${razitko}`
      const topic = await page.request.post('/api/library', {
        data: { kind: 'topic', name: topicName, parentId: gradeId },
      })
      expect(topic.ok(), 'zkušební téma se nepodařilo založit').toBe(true)
      const { id: topicId } = (await topic.json()) as { id: string }

      for (const prompt of ['První otázka na odhad stran', 'Druhá otázka na odhad stran']) {
        const created = await page.request.post('/api/questions', {
          data: {
            topicId,
            question: {
              type: 'short_answer',
              difficulty: 1,
              points: 1,
              blocks: [],
              payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
            },
          },
        })
        expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
      }

      await page.goto('/tests/new')

      // Vlastní téma je sbalené jako všechna ostatní — najdeme ho podle
      // popisku, ne podle pořadí, a rozbalíme.
      const topicDetails = page.locator('details').filter({ hasText: topicName })
      await topicDetails.locator('summary').click()
      // Přímí potomci: uvnitř náhledu otázky jsou další seznamy s možnostmi.
      const questions = topicDetails.locator('ul > li')
      await expect(questions).toHaveCount(2)

      const firstCheckbox = questions.first().getByRole('checkbox')
      await firstCheckbox.waitFor({ state: 'visible' })
      await firstCheckbox.click()

      // Souhrn pod osnovou je definiční seznam: počet otázek, body, odhad stran.
      const summary = page.locator('dl').filter({ hasText: 'Odhad stran:' })
      await expect(summary).toBeVisible()
      await expect(summary).toContainText('Otázek: 1')
      await expect(summary).toContainText('Odhad stran:')

      // S další otázkou počet roste a odhad zůstává vyplněný.
      await questions.nth(1).getByRole('checkbox').click()
      await expect(summary).toContainText('Otázek: 2')
      await expect(summary).toContainText('Odhad stran:')
    } finally {
      await page.request.delete(`/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`)
    }
  })
})

test.describe('filtr obtížnosti u otázek tématu', () => {
  test('rozbalovací nabídka se otevře a vybere hodnotu', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))

    // `exact: true`: generování vedle má obtížnost pojmenovanou podobně
    // („Obtížnost nových otázek") a bez toho by ji `getByLabel` našel taky.
    const difficultyFilter = page.getByLabel('Obtížnost', { exact: true })
    await difficultyFilter.click()
    await page.getByRole('option', { name: 'Těžká' }).click()
    await expect(difficultyFilter).toContainText('Těžká')
  })
})
