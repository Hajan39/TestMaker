/**
 * Vývojový server nad zahoditelnou databází `dev.db` se zapnutým přihlašováním.
 *
 *   pnpm dev:sandbox            # http://localhost:3200
 *   pnpm dev:sandbox --reset    # databázi postaví znovu od nuly
 *
 * Na nových věcech se pracuje tady, ne na `pnpm dev` — ten běží nad ostrou
 * `local.db` se skutečnými materiály. Data i účty staví `seed-e2e.ts`
 * (vymyšlený obsah); všechny účty mají heslo `e2e-tajne-heslo`:
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
  // Vlastní složka sestavení, aby server běžel vedle `pnpm dev`.
  NEXT_DIST_DIR: '.next-dev',
  // Pevné tajemství stačí: databáze i účty jsou jen na zkoušku.
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
