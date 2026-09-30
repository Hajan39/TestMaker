import { defineConfig, devices } from '@playwright/test'

/**
 * Testy v prohlížeči. Doplňují jednotkové testy o to, co se dá ověřit jedině
 * skutečným vykreslením: rozvržení na různých šířkách, přetékání, rolování,
 * chování dialogů a rozbalovacích nabídek.
 *
 * Běží proti vlastní databázi `apps/web/e2e.db`, nikdy proti ostré `local.db` —
 * testy zakládají i mažou data a jeden dřívější běh z ostré knihovny smazal
 * skutečné předměty. Server si Playwright spouští sám na vlastním portu 3100,
 * aby se omylem nenapojil na `pnpm dev` běžící nad ostrou databází.
 *
 * Databáze se postaví sama před spuštěním serveru (migrace, šablony a
 * vymyšlená data); ručně ji jde kdykoli postavit znovu:
 *
 *   pnpm --filter @testmaker/web e2e:db
 */

const PORT = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // Sada je dlouhá a poslední testy běží na stroji, který už hodinu překládá;
  // výchozích 30 s pak u snímků obrazovek nestačí, i když samostatně doběhnou
  // za pár sekund.
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Majitel používá Safari a už na něm narazil na chybu, kterou Chrome neukázal.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // Databáze se dopřipraví, jen pokud ještě není — opakovaný běh testů tak
    // nezdržuje a data z předchozího běhu zůstávají.
    command: `pnpm exec tsx --conditions=react-server scripts/seed-e2e.ts --if-missing && pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: {
      DATABASE_URL: 'file:./e2e.db',
      DATABASE_AUTH_TOKEN: '',
      // Podvržený model, aby rozhraní generování bylo vidět vždycky — jinak by
      // výsledek testů záležel na tom, jestli má vývojář klíč v `.env.local`.
      // Skutečné volání modelu testy podvrhují přes `page.route`; s tímhle
      // klíčem by stejně neprošlo.
      AI_MODELS: 'google:e2e',
      GOOGLE_GENERATIVE_AI_API_KEY: 'e2e',
      // Vlastní složka sestavení: jinak se server nerozběhne vedle `pnpm dev`.
      NEXT_DIST_DIR: '.next-e2e',
    },
    // Nikdy se nenapojovat na cizí server: ten by mohl běžet nad ostrou databází.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
