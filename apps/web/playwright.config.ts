import { defineConfig, devices } from '@playwright/test'

/**
 * Testy v prohlížeči. Doplňují jednotkové testy o to, co se dá ověřit jedině
 * skutečným vykreslením: rozvržení na různých šířkách, přetékání, rolování,
 * chování dialogů a rozbalovacích nabídek.
 *
 * Běží proti vývojovému serveru s naplněnou databází. Server si spustí sám,
 * pokud už neběží.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
