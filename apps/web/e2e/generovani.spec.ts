import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Nastavení počtu otázek. Kromě „vytvoř tolik nových" musí jít zvolit
 * „doplň téma na tenhle počet", protože po kontrole konceptů učitelka část
 * zamítne a chce počet dorovnat, ne začínat znovu.
 */
test.describe('počet otázek při generování', () => {
  test('doplňování ukáže, kolik otázek přibude', async ({ page, request }) => {
    const path = await testTopicPath(request)
    await page.goto(path)

    const settings = page.getByRole('button', { name: 'Nastavení generování' })
    test.skip((await settings.count()) === 0, 'Generování není nakonfigurované.')
    await settings.click()

    // Téma z fixtury má tři otázky; doplnění na pět jich tedy vytvoří dvě.
    await page.getByLabel('Počet otázek', { exact: true }).fill('5')
    await page.getByLabel('Počet otázek znamená').click()
    await page.getByRole('option', { name: 'Doplnit na celkový počet' }).click()

    await expect(page.getByText(/Doplní se \d+/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dogenerovat z tématu' })).toBeEnabled()

    // Nižší počet, než téma má: není co doplňovat a generovat nejde.
    await page.getByLabel('Počet otázek', { exact: true }).fill('1')
    await expect(page.getByText('Zvolený počet je už naplněný, nic se nevytvoří.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dogenerovat z tématu' })).toBeDisabled()
  })
})
