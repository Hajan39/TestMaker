import { expect, test } from '@playwright/test'

/**
 * Mazání v knihovně je kaskádové, takže se musí vždy ptát a vždy ukázat dopad.
 * Test si zakládá vlastní data, aby nesahal na skutečnou knihovnu.
 */

async function createDisposableTopic(request: typeof test.step extends never ? never : any) {
  const response = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: 'ZKOUŠKA/9. ročník/Smazatelné téma.txt',
          fileName: 'Smazatelné téma.txt',
          subject: 'ZKOUŠKA',
          grade: '9. ročník',
          topic: 'Smazatelné téma',
          mimeType: 'text/plain',
          sizeBytes: 120,
          text: 'Text jen pro ověření mazání. '.repeat(6),
          pageCount: null,
          needsOcr: false,
          contentHash: `zkouska-${Date.now()}`,
        },
      ],
    },
  })
  expect(response.ok()).toBe(true)
}

test.describe('mazání v knihovně', () => {
  test('ukáže dopad a smaže až po potvrzení', async ({ page }) => {
    await createDisposableTopic(page.request)
    await page.goto('/')

    // Předmět se objeví v přehledu knihovny.
    const heading = page.locator('h2', { hasText: 'ZKOUŠKA' })
    await expect(heading).toBeVisible()

    await page.getByRole('button', { name: 'Smazat předmět' }).last().click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Dopad se dopočítá a vypíše, co zmizí.
    await expect(dialog).toContainText('ZKOUŠKA')
    await expect(dialog).toContainText('materiál')
    await expect(dialog).toContainText('Akci nejde vrátit zpět.')

    // Zrušení nic nesmaže.
    await dialog.getByRole('button', { name: 'Zrušit' }).click()
    await expect(page.locator('h2', { hasText: 'ZKOUŠKA' })).toBeVisible()

    await page.getByRole('button', { name: 'Smazat předmět' }).last().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()

    await expect(page.locator('h2', { hasText: 'ZKOUŠKA' })).toHaveCount(0)
  })
})
