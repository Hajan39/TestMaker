import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Seznam testů: hledání, filtr podle šablony a kopie hotového testu.
 *
 * Kopie je tu kvůli loňským písemkám — mají jít použít znovu, aniž by se
 * přepsal originál, a se zněním otázek, které se tehdy tisklo.
 */

const PREFIX = 'E2E písemka'

test.describe('seznam testů', () => {
  test('hledání zúží seznam a zůstane v adrese', async ({ page }) => {
    const nazev = `${PREFIX} o sopkách ${Date.now()}`
    const jiny = `${PREFIX} o řekách ${Date.now()}`
    await createTest(page.request, nazev)
    await createTest(page.request, jiny)

    await page.goto('/tests')
    await hledej(page, 'o sopkách')

    const odkaz = page.getByRole('link', { name: nazev })
    await expect(odkaz).toBeVisible()
    await expect(page.getByRole('link', { name: jiny })).toHaveCount(0)

    // Odkaz s filtrem se dá poslat a otevřít znovu.
    const url = page.url()
    await page.goto('/tests')
    await page.goto(url)
    await expect(page.getByLabel('Hledat')).toHaveValue('o sopkách')
    await expect(page.getByRole('link', { name: nazev })).toBeVisible()
  })

  test('kopie testu vznikne vedle originálu a nepřepíše ho', async ({ page }) => {
    const nazev = `${PREFIX} ke kopírování ${Date.now()}`
    await createTest(page.request, nazev)

    await page.goto(`/tests?q=${encodeURIComponent(nazev)}`)
    await expect(page.getByRole('link', { name: nazev, exact: true })).toBeVisible()

    await page.getByRole('button', { name: /^Akce u testu/ }).first().click()
    await page.getByRole('menuitem', { name: 'Vytvořit kopii' }).click()

    await expect(page.getByText(/^Kopie /).first()).toBeVisible()

    // Seznam se obnoví sám; kopie se do filtru vejde, protože má název
    // originálu i s příponou „(kopie)“.
    await expect(page.getByRole('link', { name: nazev, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: `${nazev} (kopie)`, exact: true })).toBeVisible()

    const radky = page.locator('tbody tr')
    await expect(radky).toHaveCount(2)
    const otazky = await radky.evaluateAll((rows) =>
      rows.map((row) => row.querySelectorAll('td')[1]?.textContent?.trim() ?? ''),
    )
    expect(otazky[0]).toBe(otazky[1])
  })

  test('filtr podle třídy zúží seznam a zůstane v adrese', async ({ page }) => {
    const stamp = Date.now()
    const tridaA = await createGrade(page.request, `E2E předmět A ${stamp}`, `Třída A ${stamp}`)
    const tridaB = await createGrade(page.request, `E2E předmět B ${stamp}`, `Třída B ${stamp}`)
    const nazevA = `${PREFIX} třídy A ${stamp}`
    const nazevB = `${PREFIX} třídy B ${stamp}`
    await createTest(page.request, nazevA, { gradeId: tridaA.gradeId })
    await createTest(page.request, nazevB, { gradeId: tridaB.gradeId })

    await page.goto('/tests')
    await page.getByLabel('Třída').click()
    await page.getByRole('option', { name: tridaA.label }).click()

    await expect(page).toHaveURL(new RegExp(`trida=${tridaA.gradeId}`))
    await expect(page.getByRole('link', { name: nazevA })).toBeVisible()
    await expect(page.getByRole('link', { name: nazevB })).toHaveCount(0)

    // Odkaz s filtrem se dá poslat a otevřít znovu.
    const url = page.url()
    await page.goto('/tests')
    await page.goto(url)
    await expect(page.getByRole('link', { name: nazevA })).toBeVisible()
    await expect(page.getByRole('link', { name: nazevB })).toHaveCount(0)
  })
})

/**
 * Napíše hledaný text a počká, až se propíše do adresy.
 *
 * Psaní se opakuje, dokud se v adrese neobjeví: ve WebKitu se stane, že první
 * písmena padnou do políčka dřív, než se stránka v prohlížeči oživí, a React
 * se o nich nedozví.
 */
async function hledej(page: Page, text: string): Promise<void> {
  const pole = page.getByLabel('Hledat')
  await expect(async () => {
    // Políčko se pokaždé vyprázdní: opakované vyplnění touž hodnotou by
    // žádnou událost nevyvolalo a čekání by nemělo na co čekat.
    await pole.fill('')
    await pole.fill(text)
    await expect(page).toHaveURL(/q=/, { timeout: 3000 })
  }).toPass({ timeout: 20_000 })
}

/** Test s jednou otázkou z banky. Otázka se bere z první, kterou knihovna má. */
async function createTest(
  request: APIRequestContext,
  title: string,
  options: { gradeId?: string } = {},
): Promise<string> {
  // `builtin-klasicka` je vestavěná šablona, kterou zakládá i seed testovací
  // databáze — na jiné id se tu spolehnout nedá.
  const bank = await request.get('/api/questions?status=approved&limit=1')
  expect(bank.ok()).toBe(true)
  const { items } = (await bank.json()) as { items: { id: string }[] }
  expect(items.length, 'v knihovně nejsou schválené otázky').toBeGreaterThan(0)

  const created = await request.post('/api/tests', {
    data: {
      title,
      description: null,
      graded: true,
      templateId: 'builtin-klasicka',
      gradeId: options.gradeId ?? null,
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      showKey: true,
      items: [{ kind: 'question', questionId: items[0]!.id }],
    },
  })
  expect(created.ok(), 'zkušební test se nepodařilo založit').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/**
 * Vlastní předmět a ročník pro filtr podle třídy — vznikají v knihovně přes
 * API, ať test nezávisí na tom, jaké třídy má seedovaná databáze zrovna teď.
 */
async function createGrade(
  request: APIRequestContext,
  subjectName: string,
  gradeName: string,
): Promise<{ gradeId: string; label: string }> {
  const subject = await request.post('/api/library', { data: { kind: 'subject', name: subjectName } })
  expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }

  const grade = await request.post('/api/library', {
    data: { kind: 'grade', name: gradeName, parentId: subjectId },
  })
  expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  return { gradeId, label: `${subjectName} · ${gradeName}` }
}
