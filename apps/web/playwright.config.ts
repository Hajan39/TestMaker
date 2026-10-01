import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests. They complement unit tests with what can only be checked by
 * real rendering: layout at various widths, overflow, scrolling, behaviour of
 * dialogs and dropdowns.
 *
 * They run against their own database `apps/web/e2e.db`, never the live
 * `local.db` — tests create and delete data and an earlier run deleted real
 * subjects from the live library. Playwright starts the server itself on its
 * own port 3100 so it never attaches to a `pnpm dev` running over the live
 * database.
 *
 * The database builds itself before the server starts (migrations, templates
 * and made-up data); it can be rebuilt by hand at any time:
 *
 *   pnpm --filter @testmaker/web e2e:db
 */

const PORT = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // The suite is long and the last tests run on a machine that has been
  // compiling for an hour; the default 30 s is then not enough for
  // screenshots, even though they finish in seconds on their own.
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The owner uses Safari and has already hit a bug there that Chrome did not show.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // The database is prepared only if missing — so a repeated test run is
    // not slowed down and data from the previous run stays.
    command: `pnpm exec tsx --conditions=react-server scripts/seed-e2e.ts --if-missing && pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: {
      DATABASE_URL: 'file:./e2e.db',
      DATABASE_AUTH_TOKEN: '',
      // A fake model so the generation UI is always visible — otherwise the
      // test result would depend on whether the developer has a key in
      // `.env.local`. Tests fake the real model call via `page.route`; with
      // this key it would not go through anyway.
      AI_MODELS: 'google:e2e',
      GOOGLE_GENERATIVE_AI_API_KEY: 'e2e',
      // Own build folder: otherwise the server won't start next to `pnpm dev`.
      NEXT_DIST_DIR: '.next-e2e',
    },
    // Never attach to a foreign server: it could be running over the live database.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
