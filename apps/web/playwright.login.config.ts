import { defineConfig, devices } from '@playwright/test'

/**
 * Testy přihlášení, rolí a vlastnictví. Mají vlastní konfiguraci, protože
 * potřebují server se zapnutým přihlašováním (`AUTH_SECRET` a účty
 * v databázi), kdežto ostatní testy v prohlížeči běží bez něj — jinak by se
 * každý z nich musel nejdřív přihlašovat.
 *
 * Aby si oba běhy nepřekážely, má tenhle vlastní port (3101), vlastní databázi
 * (`apps/web/e2e-login.db`) i vlastní složku sestavení. Na ostrou `local.db`
 * ani na port 3000 nesahá.
 *
 *   cd apps/web && pnpm exec playwright test -c playwright.login.config.ts
 */

const PORT = Number(process.env.E2E_LOGIN_PORT ?? 3101)

/** Hesla zkušebních účtů; stejná hodnota je v `scripts/seed-e2e.ts`. */
export const HESLO = 'e2e-tajne-heslo'

/** Účty, které staví `scripts/seed-e2e.ts`. */
export const UCTY = {
  spravce: 'spravce@localhost',
  ucitelkaA: 'ucitelka.a@localhost',
  ucitelkaB: 'ucitelka.b@localhost',
  nahled: 'nahled@localhost',
} as const

export type Osoba = keyof typeof UCTY

export default defineConfig({
  testDir: './e2e',
  testMatch: /prihlaseni\.(spec|setup)\.ts|role\.spec\.ts|sprava\.spec\.ts|vlastnictvi\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  /*
   * Nejdřív se jednou přihlásí každá zkušební osoba a uloží si cookie do
   * `e2e/.auth`; testy pak jen řeknou, za koho jedou. Bez toho by se každý
   * test proklikával přihlašováním znovu.
   *
   * Druhý prohlížeč by k tomu nic nepřidal, jen by běh prodloužil.
   */
  projects: [
    { name: 'setup', testMatch: /prihlaseni\.setup\.ts/ },
    { name: 'chromium', dependencies: ['setup'], use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `pnpm exec tsx --conditions=react-server scripts/seed-e2e.ts --if-missing && pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    env: {
      DATABASE_URL: 'file:./e2e-login.db',
      DATABASE_AUTH_TOKEN: '',
      E2E_DATABASE_FILE: 'e2e-login.db',
      NEXT_DIST_DIR: '.next-e2e-login',
      AUTH_SECRET: 'e2e-tajemstvi-na-podpis-cookie',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
