import { defineConfig, devices } from '@playwright/test'

/**
 * Sign-in, role and ownership tests. They have their own config because they
 * need a server with sign-in enabled (`AUTH_SECRET` and accounts in the
 * database), whereas the other browser tests run without it — otherwise each
 * of them would have to sign in first.
 *
 * So the two runs don't get in each other's way, this one has its own port
 * (3101), its own database (`apps/web/e2e-login.db`) and its own build folder.
 * It touches neither the live `local.db` nor port 3000.
 *
 *   cd apps/web && pnpm exec playwright test -c playwright.login.config.ts
 */

const PORT = Number(process.env.E2E_LOGIN_PORT ?? 3101)

/** Password of the test accounts; the same value is in `scripts/seed-e2e.ts`. */
export const PASSWORD = 'e2e-tajne-heslo'

/** Accounts built by `scripts/seed-e2e.ts`. */
export const ACCOUNTS = {
  spravce: 'spravce@localhost',
  ucitelkaA: 'ucitelka.a@localhost',
  ucitelkaB: 'ucitelka.b@localhost',
  nahled: 'nahled@localhost',
  administrator: 'admin@localhost',
  spravceB: 'spravce.b@localhost',
  ucitelkaC: 'ucitelka.c@localhost',
} as const

export type Person = keyof typeof ACCOUNTS

export default defineConfig({
  testDir: './e2e',
  testMatch:
    /login\.(spec|setup)\.ts|role\.spec\.ts|management\.spec\.ts|ownership\.spec\.ts|administration\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  /*
   * First each test person signs in once and stores the cookie in
   * `e2e/.auth`; tests then just say whom they run as. Without it every test
   * would click through sign-in again.
   *
   * A second browser would add nothing here, only lengthen the run.
   */
  projects: [
    { name: 'setup', testMatch: /login\.setup\.ts/ },
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
