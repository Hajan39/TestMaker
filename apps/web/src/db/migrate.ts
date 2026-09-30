/**
 * Spustí migrace proti DATABASE_URL (lokální soubor i Turso). Databázi ze
 * staré řady migrací převede na čistý základ — viz `db/migrace.ts`.
 */
import { existsSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { cekaMigrace, migrovat } from './migrace'

async function main() {
  const url = process.env.DATABASE_URL || 'file:./local.db'
  // Existenci souboru je třeba zjistit dřív, než ho klient založí prázdný.
  const soubor = url.startsWith('file:') ? url.slice('file:'.length) : null
  const existoval = soubor !== null && existsSync(soubor)
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN })

  // U souboru se před migrací udělá záloha vedle něj; Turso má vlastní
  // obnovu k okamžiku v čase.
  if (soubor && existoval && (await cekaMigrace(client))) {
    const zaloha = `${soubor}.pred-migraci-${new Date().toISOString().replace(/[:.]/g, '-')}`
    // `VACUUM INTO` dá ucelený snímek i s tím, co ještě visí v -wal souboru.
    await client.execute({ sql: 'VACUUM INTO ?', args: [zaloha] })
    console.log(`Záloha: ${zaloha}`)
  }

  const vysledek = await migrovat(client)
  console.log(
    vysledek === 'prevedeno'
      ? 'Databáze převedena ze staré řady migrací na čistý základ; data zůstala.'
      : 'Migrace hotové.',
  )
  client.close()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
