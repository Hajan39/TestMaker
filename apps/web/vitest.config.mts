import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const src = resolve(import.meta.dirname, 'src')

/**
 * Tests of the web server side. They run over the real API and library
 * functions, only against a temporary file database — no database mocks, so a
 * test also catches a bug in a query or a migration.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Each file has its own database, so tests don't touch each other's data.
    fileParallelism: true,
    testTimeout: 30_000,
  },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${src}/$1` },
      /**
       * `server-only` is just a marker for the Next.js bundler — it cannot be
       * loaded outside it. So it is not removed from the sources (it keeps
       * server code out of the browser), only replaced here by an empty module.
       */
      { find: /^server-only$/, replacement: resolve(import.meta.dirname, 'test/stubs/server-only.ts') },
    ],
  },
})
