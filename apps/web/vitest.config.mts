import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const src = resolve(import.meta.dirname, 'src')

/**
 * Testy serverové části webu. Běží nad skutečnými funkcemi API a knihovny,
 * jen proti dočasné databázi v souboru — žádné atrapy databáze, aby test
 * chytil i chybu v dotazu nebo v migraci.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Každý soubor má vlastní databázi, takže si testy navzájem nesahají do dat.
    fileParallelism: true,
    testTimeout: 30_000,
  },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${src}/$1` },
      /**
       * `server-only` je jen značka pro bundler Next.js — mimo něj se nedá
       * načíst. Ze zdrojáků se proto neodstraňuje (hlídá, aby serverový kód
       * nespadl do prohlížeče), jen se tady nahradí prázdným modulem.
       */
      { find: /^server-only$/, replacement: resolve(import.meta.dirname, 'test/stubs/server-only.ts') },
    ],
  },
})
