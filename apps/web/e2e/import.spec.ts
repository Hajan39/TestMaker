import { expect, test } from '@playwright/test'

/**
 * Náhled importu. Dokud si učitelka zařazení neprojde, v knihovně nesmí nic
 * přibýt — právě odhad Předmět → Ročník → Téma z cesty je to, co se nejčastěji
 * netrefí. Test proto importuje dva samostatné soubory (bez složky, tedy
 * s prázdným zařazením), v náhledu zařazení doplní, jeden řádek vynechá
 * a teprve pak uloží.
 */

const SUBJECT = 'PŘÍRODOPIS'
const GRADE = '7. ročník'
const TOPIC = 'Hmyz a jeho vývoj'

/** Dost dlouhý text, aby se soubor nezahodil jako prázdný a téma nebylo chudé. */
function text(sentence: string): string {
  return `${sentence} `.repeat(30)
}

const KEPT = {
  name: 'Hmyz a jeho vývoj.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(text('Hmyz prochází proměnou dokonalou nebo nedokonalou.'), 'utf8'),
}

const DROPPED = {
  name: '7.4 Hmyz a jeho vývoj (opakování).txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(text('Opakování na hmyz před písemkou z bezobratlých.'), 'utf8'),
}

test.describe('náhled importu', () => {
  test('samostatné soubory se zařadí ručně a uloží se jen vybrané', async ({ page }) => {
    // Úklid po případném dřívějším spadlém běhu: téma téhož jména by rozbilo
    // kontrolu „dokud se náhled nepotvrdí, v knihovně nic není".
    const zbytky = await page.request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
    for (const found of ((await zbytky.json()) as { results: { topicId: string }[] }).results) {
      await page.request.delete(`/api/library?kind=topic&id=${encodeURIComponent(found.topicId)}`)
    }

    await page.goto('/import')

    // Vedle výběru složky musí být i výběr jednotlivých souborů a zóna pro přetažení.
    await expect(page.getByRole('button', { name: 'Vybrat složku' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Vybrat soubory' })).toBeVisible()
    await expect(page.getByText('přetáhni myší')).toBeVisible()

    await page.locator('[data-testid="import-files"]').setInputFiles([KEPT, DROPPED])

    // Oba soubory patří k témuž tématu, takže z nich vznikne jediná skupina
    // — a protože cesta u samostatného souboru nic neříká, zůstane bez předmětu.
    const group = page.locator('[data-testid="import-group"]')
    await expect(group).toHaveCount(1)
    await expect(page.getByText('Předmět z cesty vyčíst nešel')).toBeVisible()
    await expect(group.getByLabel('Téma')).toHaveValue(TOPIC)

    // Dokud se náhled nepotvrdí, v knihovně nic není.
    const before = await page.request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
    expect(((await before.json()) as { results: unknown[] }).results).toHaveLength(0)

    // Zařazení doplníme po znacích jako od učitelky: `fill()` ve WebKitu
    // u těchto polí nevyvolá React onChange.
    await group.getByLabel('Předmět').pressSequentially(SUBJECT)
    await group.getByLabel('Ročník').pressSequentially(GRADE)

    // Jeden řádek vynecháme — do knihovny má jít jen ten druhý.
    await group.getByRole('checkbox', { name: `Zahrnout ${DROPPED.name}` }).click()
    await expect(page.getByRole('button', { name: 'Importovat (1)' })).toBeVisible()

    await page.getByRole('button', { name: 'Importovat (1)' }).click()
    await expect(page.getByText(/Naimportováno 1 materiál/)).toBeVisible()

    // Po importu se nabídne, kam pokračovat — ne jen přehled.
    await expect(page.getByRole('button', { name: `Ročník ${GRADE}` })).toBeVisible()
    await page.getByRole('button', { name: `Téma ${TOPIC}` }).click()

    await expect(page).toHaveURL(/\/topics\//)
    await expect(page.getByRole('heading', { name: TOPIC })).toBeVisible()
    await expect(page.getByText(KEPT.name).first()).toBeVisible()
    await expect(page.getByText(DROPPED.name)).toHaveCount(0)

    // Uklidit po sobě: téma, které test založil, v knihovně zůstat nesmí.
    const topicId = new URL(page.url()).pathname.split('/').pop() ?? ''
    expect(topicId).not.toHaveLength(0)
    const deleted = await page.request.delete(
      `/api/library?kind=topic&id=${encodeURIComponent(topicId)}`,
    )
    expect(deleted.ok(), 'zkušební téma se nepodařilo uklidit').toBe(true)
  })
})
