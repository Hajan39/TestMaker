import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Deleting in the library cascades, so it must always ask and always show the impact.
 * The test creates its own data so it never touches the real library.
 */

async function createDisposableTopic(request: APIRequestContext) {
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

test.describe('deleting in the library', () => {
  test('shows the impact and deletes only after confirmation', async ({ page }) => {
    await createDisposableTopic(page.request)
    await page.goto('/')

    // The subject appears in the library overview. It is looked up by exact name
    // and deleted via the button in its own section — "last on the page" would
    // hit another subject as soon as the library holds anything else.
    const heading = page.getByRole('heading', { name: 'ZKOUŠKA', exact: true })
    await expect(heading).toBeVisible()
    // `.last()` is the innermost section — layout panes are `section`s too.
    const section = page.locator('section', { has: heading }).last()

    await section.getByRole('button', { name: 'Smazat předmět' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // The impact is computed and lists what will disappear.
    await expect(dialog).toContainText('ZKOUŠKA')
    await expect(dialog).toContainText('materiál')
    await expect(dialog).toContainText('Akci nejde vrátit zpět.')

    // Cancelling deletes nothing.
    await dialog.getByRole('button', { name: 'Zrušit' }).click()
    await expect(heading).toBeVisible()

    await section.getByRole('button', { name: 'Smazat předmět' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()

    await expect(heading).toHaveCount(0)
  })
})
