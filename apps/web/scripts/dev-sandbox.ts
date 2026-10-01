/**
 * Development server over the throwaway `dev.db` database with sign-in enabled.
 *
 *   pnpm dev:sandbox            # http://localhost:3200
 *   pnpm dev:sandbox --reset    # rebuilds the database from scratch
 *
 * New work happens here, not on `pnpm dev` — that runs over the live
 * `local.db` with real materials. Data and accounts are built by `seed-e2e.ts`
 * (made-up content); all accounts have the password `e2e-tajne-heslo`:
 *
 *   admin@localhost        administrator
 *   spravce@localhost      spravce
 *   ucitelka.a@localhost   ucitelka
 *   nahled@localhost       nahled
 */
import { spawnSync } from 'node:child_process'

const PORT = process.env.DEV_PORT ?? '3200'

const env = {
  ...process.env,
  DATABASE_URL: 'file:./dev.db',
  DATABASE_AUTH_TOKEN: '',
  E2E_DATABASE_FILE: 'dev.db',
  // Own build folder so the server can run next to `pnpm dev`.
  NEXT_DIST_DIR: '.next-dev',
  // A fixed secret is enough: the database and accounts are only for trying things out.
  AUTH_SECRET: 'dev-sandbox-tajemstvi-na-podpis-cookie',
}

function run(args: string[]): void {
  const { status } = spawnSync('pnpm', ['exec', ...args], { env, stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
}

run([
  'tsx',
  '--conditions=react-server',
  'scripts/seed-e2e.ts',
  ...(process.argv.includes('--reset') ? [] : ['--if-missing']),
])
run(['next', 'dev', '--port', PORT])
