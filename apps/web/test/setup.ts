import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { afterAll } from 'vitest'
import { VYCHOZI_UCET_ID } from '../src/lib/vychozi'

/** Škola a účet, které mají všechna testovací data. */
export const TEST_SKOLA_ID = 'skola-vyvoj'
export const TEST_UCET_ID = VYCHOZI_UCET_ID

/**
 * Každý testovací soubor dostane vlastní prázdnou databázi v dočasné složce
 * a spustí do ní migrace z `apps/web/drizzle`. Testy tak jedou nad stejným
 * schématem jako aplikace, ale skutečná data majitele (`apps/web/local.db`)
 * zůstávají nedotčená.
 *
 * Musí se to stát dřív, než se načte `@/db` — klient se tam vyrábí při
 * importu z `DATABASE_URL`. Proto je tohle setupFile, ne `beforeAll` v testu.
 */
const dir = mkdtempSync(join(tmpdir(), 'testmaker-test-'))
const file = join(dir, 'test.db')

process.env.DATABASE_URL = `file:${file}`
delete process.env.DATABASE_AUTH_TOKEN

// Pojistka proti překlepu: kdyby cesta mířila na skutečnou databázi, testy
// by ji vymazaly. Radši spadnout hned.
if (!file.startsWith(tmpdir()) || file.includes('local.db')) {
  throw new Error(`Testovací databáze musí být v dočasné složce, ne v ${file}`)
}

// Klient aplikace se v nevýrobním režimu drží na globálu kvůli hot reloadu;
// tady by to znamenalo sdílet databázi mezi soubory.
delete (globalThis as { __testmakerDb?: unknown }).__testmakerDb

const client = createClient({ url: `file:${file}` })
await migrate(drizzle(client), {
  migrationsFolder: resolve(import.meta.dirname, '..', 'drizzle'),
})

/*
 * Škola a účet, pod kterým testy pracují. Přihlašování je v testech vypnuté
 * (není `AUTH_SECRET`), takže se aplikace chová jako na notebooku a sahá po
 * výchozím účtu — ten ale musí v databázi opravdu být, jinak nemají cizí
 * klíče u testů, hlavolamů a fronty na co ukazovat.
 */
await client.execute({
  sql: "insert into schools (id, name, slug) values (?, 'Testovací škola', 'test')",
  args: [TEST_SKOLA_ID],
})
await client.execute({
  sql: "insert into users (id, school_id, email, name, role) values (?, ?, 'test@localhost', 'Testovací správce', 'spravce')",
  args: [TEST_UCET_ID, TEST_SKOLA_ID],
})
client.close()

afterAll(() => {
  // Na Windows drží libsql soubor databáze otevřený i po skončení testů a smazání
  // skončí EPERM. Neuklizená dočasná složka je menší zlo než červený běh.
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
})
