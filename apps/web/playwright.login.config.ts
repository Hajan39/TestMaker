import { defineConfig, devices } from '@playwright/test'

/**
 * Testy přihlášení. Mají vlastní konfiguraci, protože potřebují server se
 * zapnutým přihlašováním (`APP_PASSWORD`), kdežto ostatní testy v prohlížeči
 * běží bez hesla — jinak by se každý z nich musel nejdřív přihlašovat.
 *
 * Aby si oba běhy nepřekážely, má tenhle vlastní port (3101), vlastní databázi
 * (`apps/web/e2e-login.db`) i vlastní složku sestavení. Na ostrou `local.db`
 * ani na port 3000 nesahá.
 *
 *   cd apps/web && pnpm exec playwright test -c playwright.login.config.ts
 */

const PORT = Number(process.env.E2E_LOGIN_PORT ?? 3101)

export const HESLO = 'e2e-tajne-heslo'

export default defineConfig({
  testDir: './e2e',
  testMatch: /prihlaseni\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Přihlášení je jedna obrazovka a jedna cookie; druhý prohlížeč by k tomu
  // nic nepřidal, jen by běh prodloužil.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec tsx scripts/seed-e2e.ts --if-missing && pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    env: {
      DATABASE_URL: 'file:./e2e-login.db',
      DATABASE_AUTH_TOKEN: '',
      E2E_DATABASE_FILE: 'e2e-login.db',
      NEXT_DIST_DIR: '.next-e2e-login',
      APP_PASSWORD: HESLO,
      AUTH_SECRET: 'e2e-tajemstvi-na-podpis-cookie',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
