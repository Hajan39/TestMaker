/**
 * Smaže celou databázi a postaví ji znovu čistou: migrace, první škola se
 * šablonami a administrátor s výchozím heslem, které se musí při prvním
 * přihlášení změnit. Všechen obsah (knihovna, otázky, písemky, účty) zmizí.
 *
 *   DATABASE_URL=… DATABASE_AUTH_TOKEN=… ADMIN_HESLO=… \
 *   pnpm --filter @testmaker/web db:vycistit -- \
 *     --potvrdit <jméno databáze> --skola "Název školy" --email admin@skola.cz
 *
 * Jméno databáze je u Tursa první část adresy (`libsql://<jméno>.turso.io`),
 * u souboru jeho název (`local.db`). Bez shody se nic nestane — omylem
 * spuštěný skript nesmí smazat jinou databázi, než kterou měl autor na mysli.
 *
 * Před smazáním se celý obsah vypíše do `zaloha-<jméno>-<čas>.sql` v aktuální
 * složce (schéma i data jako SQL příkazy); obnovit jde přes `sqlite3` nebo
 * `turso db shell`. Workflow `vycistit-databazi.yml` ho ukládá jako artefakt.
 *
 * Heslo se nepředává přepínačem (zůstalo by v historii příkazů), ale
 * proměnnou `ADMIN_HESLO`.
 */
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createClient, type Client, type Value } from '@libsql/client'
import { loadEnv } from './env'

function prepinac(jmeno: string): string | null {
  const index = process.argv.indexOf(`--${jmeno}`)
  const hodnota = index < 0 ? undefined : process.argv[index + 1]
  return hodnota && !hodnota.startsWith('--') ? hodnota.trim() : null
}

/** Jméno databáze z adresy, se kterým se porovnává potvrzení. */
function jmenoDatabaze(url: string): string {
  if (url.startsWith('file:')) return basename(url.slice('file:'.length))
  return new URL(url).hostname.split('.')[0] ?? url
}

function sqlHodnota(hodnota: Value): string {
  if (hodnota === null) return 'NULL'
  if (typeof hodnota === 'number' || typeof hodnota === 'bigint') return String(hodnota)
  if (hodnota instanceof ArrayBuffer) return `X'${Buffer.from(hodnota).toString('hex')}'`
  return `'${String(hodnota).replaceAll("'", "''")}'`
}

/**
 * Celá databáze jako SQL příkazy. `ponytail:` tabulka se čte naráz do paměti;
 * na knihovnu jedné školy to stačí, u velkých dat by se četlo po stránkách.
 */
async function vypsat(client: Client): Promise<string> {
  const objekty = await client.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'index', name",
  )
  const radky = ['PRAGMA foreign_keys = OFF;', 'BEGIN;']
  for (const objekt of objekty.rows) {
    radky.push(`${String(objekt.sql)};`)
    if (objekt.type !== 'table') continue
    const data = await client.execute(`SELECT * FROM "${String(objekt.name)}"`)
    const sloupce = data.columns.map((c) => `"${c}"`).join(', ')
    for (const row of data.rows) {
      const hodnoty = data.columns.map((_, i) => sqlHodnota(row[i] ?? null)).join(', ')
      radky.push(`INSERT INTO "${String(objekt.name)}" (${sloupce}) VALUES (${hodnoty});`)
    }
  }
  radky.push('COMMIT;')
  return `${radky.join('\n')}\n`
}

async function main(): Promise<void> {
  loadEnv()
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Chybí DATABASE_URL — skript nesmí sáhnout na výchozí local.db sám od sebe.')

  const jmeno = jmenoDatabaze(url)
  const potvrzeni = prepinac('potvrdit')
  if (potvrzeni !== jmeno) {
    throw new Error(`Potvrzení nesedí: databáze se jmenuje „${jmeno}“, přepínač --potvrdit musí mít přesně tuhle hodnotu.`)
  }
  const nazevSkoly = prepinac('skola')
  const email = prepinac('email')?.toLowerCase()
  const heslo = process.env.ADMIN_HESLO ?? ''
  if (!nazevSkoly || !email) throw new Error('Chybí --skola nebo --email pro první školu a administrátora.')

  // Heslo se kontroluje dřív, než se cokoli smaže.
  const { zahesovat, zkontrolovatSilu } = await import('../src/lib/heslo')
  const slabina = heslo ? zkontrolovatSilu(heslo) : 'Chybí proměnná ADMIN_HESLO s výchozím heslem administrátora.'
  if (slabina) throw new Error(slabina)

  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN })
  try {
    const zaloha = `zaloha-${jmeno}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`
    writeFileSync(zaloha, await vypsat(client))
    console.log(`Záloha: ${zaloha}`)

    // Vše naráz a s vypnutými cizími klíči (`client.migrate`), jako při převodu
    // v `db/migrace.ts`: napůl smazaná databáze nesmí zůstat.
    const objekty = await client.execute(
      "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%'",
    )
    await client.migrate(objekty.rows.map((o) => `DROP ${String(o.type).toUpperCase()} IF EXISTS "${String(o.name)}"`))
    console.log(`Smazáno ${objekty.rows.length} tabulek a dalších objektů.`)

    const { migrovat } = await import('../src/db/migrace')
    await migrovat(client)
    console.log('Migrace hotové.')
  } finally {
    client.close()
  }

  const { db, schools, users } = await import('../src/db/index')
  const { nasaditSablony } = await import('../src/db/sablony')
  const { newId } = await import('../src/lib/ids')
  const { slugZNazvu } = await import('../src/lib/skolaText')

  const [skola] = await db.insert(schools).values({ id: newId(), name: nazevSkoly, slug: slugZNazvu(nazevSkoly) }).returning()
  await nasaditSablony(db, skola!.id)
  await db.insert(users).values({
    id: newId(),
    schoolId: skola!.id,
    email,
    name: 'Administrátor',
    role: 'administrator',
    passwordHash: await zahesovat(heslo),
    mustChangePassword: true,
    status: 'aktivni',
  })
  console.log(`Založena škola ${nazevSkoly} a administrátor ${email}; heslo se změní při prvním přihlášení.`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
