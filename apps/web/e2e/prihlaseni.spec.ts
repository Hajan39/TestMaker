import { expect, test } from '@playwright/test'
import { HESLO, UCTY } from '../playwright.login.config'

/**
 * Přihlášení a odhlášení účtem. Běží jedině proti serveru se zapnutými účty,
 * který spouští `playwright.login.config.ts` na portu 3101. Ve sdíleném běhu
 * (`playwright.config.ts`, port 3100, server bez přihlašování) by test neměl
 * co ověřovat, proto se tam přeskočí.
 */
test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('nepřihlášenou uživatelku pustí jedině na přihlašovací stránku', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
  // Na přihlašovací stránce není navigace aplikace.
  await expect(page.getByRole('link', { name: 'Třídy' })).toHaveCount(0)
})

test('chybné heslo vypíše hlášku a nikam nepustí', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(UCTY.ucitelkaA)
  await page.getByLabel('Heslo').fill('uplne-jine-heslo')
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page.getByText(/nesouhlasí/)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('se správným heslem se přihlásí, přežije obnovení stránky a odhlásí se', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(UCTY.ucitelkaA)
  await page.getByLabel('Heslo').fill(HESLO)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Třídy' })).toBeVisible()

  // Cookie drží i po obnovení stránky.
  await page.reload()
  await expect(page).toHaveURL(/\/$/)

  // V liště je vidět, kdo je přihlášený — u jednoho počítače se ve sborovně
  // vystřídá víc lidí.
  await page.getByRole('button', { name: /Učitelka A/ }).click()
  await page.getByRole('menuitem', { name: 'Odhlásit se' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Po odhlášení už dovnitř nesmí.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('po přihlášení se vrátí tam, kam uživatelka mířila', async ({ page }) => {
  await page.goto('/tests')
  await expect(page).toHaveURL(/\/login\?dal=/)

  await page.getByLabel('E-mail').fill(UCTY.ucitelkaA)
  await page.getByLabel('Heslo').fill(HESLO)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/tests$/)
})

test('zapamatovaná třída je na uživatele, ne na prohlížeč — druhá přihlášená osoba ji nezdědí', async ({
  page,
}) => {
  // Sdílený počítač ve sborovně: jedna učitelka se odhlásí, druhá se
  // přihlásí ve stejném prohlížeči (stejné `localStorage`). Klíč pro
  // zapamatovanou třídu proto musí nést i identitu, jinak by druhou hned
  // přesměroval na třídu, kterou vůbec neotevřela.
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(UCTY.ucitelkaA)
  await page.getByLabel('Heslo').fill(HESLO)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page).toHaveURL(/\/$/)

  const subjectName = `E2E SDILENY POCITAC ${Date.now()}`
  const subject = await page.request.post('/api/library', { data: { kind: 'subject', name: subjectName } })
  expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }
  const gradeName = `Třída učitelky A ${Date.now()}`
  const grade = await page.request.post('/api/library', {
    data: { kind: 'grade', name: gradeName, parentId: subjectId },
  })
  expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  // Návštěva třídy zapamatuje `gradeId` pod klíčem učitelky A.
  await page.goto(`/tridy/${gradeId}`)
  await expect(page.getByRole('heading', { name: gradeName, exact: true })).toBeVisible()

  // Odhlášení a přihlášení jako učitelka B — beze změny prohlížeče (a tedy
  // beze změny `localStorage`).
  await page.getByRole('button', { name: /Učitelka A/ }).click()
  await page.getByRole('menuitem', { name: 'Odhlásit se' }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel('E-mail').fill(UCTY.ucitelkaB)
  await page.getByLabel('Heslo').fill(HESLO)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page).toHaveURL(/\/$/)

  // Učitelka B nesmí skončit na třídě, kterou otevřela učitelka A — knihovna
  // je společná, takže dlaždice třídy samotnou uvidí obě; nesmí ji ale
  // přesměrovat rovnou dovnitř bez jejího vlastního kliknutí.
  await expect(page).toHaveURL('/')
  await expect(page).not.toHaveURL(`/tridy/${gradeId}`)
})
