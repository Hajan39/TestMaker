import { expect, test } from '@playwright/test'

/**
 * Loading states. The `loading.tsx` skeletons cannot be triggered reliably in
 * the browser — delaying the network only postpones the transition instead of
 * showing the skeleton — so they have a unit test in `packages/ui`. Here we
 * check what we can: that the skeleton does not show for a fast response.
 *
 * Bulk deleting with its own "Mažu…" button label existed only in the
 * library-wide question bank; that was removed and the topic has no bulk
 * delete replacement (only a single "Smazat" per card), so the scenario went with it.
 */
test.describe('loading states', () => {
  test('the skeleton does not show for a fast response', async ({ page }) => {
    // Without a delay the skeleton must stay transparent: it has a show delay,
    // so a normally fast page never displays it.
    await page.goto('/tests')
    const skeleton = page.locator('[data-slot="loading"]')
    if ((await skeleton.count()) > 0) {
      await expect(skeleton.first()).not.toBeVisible()
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
