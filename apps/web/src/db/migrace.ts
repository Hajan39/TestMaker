/**
 * Migrace databáze, včetně převodu ze staré řady.
 *
 * Do září 2026 vznikalo schéma postupně jednadvaceti migracemi (dnes ve složce
 * `drizzle-historie`). Některé z nich přesouvaly data a nechávaly po sobě
 * pomocné tabulky `migration_00xx_*` pro případný návrat, a 0011 zakládala
 * zakládající školu a účet. Čistá databáze dnes vzniká jedinou migrací
 * `drizzle/0000_zaklad.sql`, bez pomocných tabulek i bez dat.
 *
 * Databáze ze staré řady (`local.db`, první nasazení Tursa) se převede
 * sama: doběhnou zbylé staré migrace, ověří se, že schéma odpovídá základu,
 * pomocné tabulky se zahodí a v `__drizzle_migrations` zůstane jediný řádek
 * základu. Data zůstávají, jak jsou. Když schéma nesedí, nic se nepřepíše
 * a migrace skončí chybou s výpisem rozdílů.
 *
 * Bez aliasu `@/` — modul čte `db/migrate.ts` spouštěný přes `tsx`.
 */
import { resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const webRoot = resolve(import.meta.dirname, '..', '..')
export const SLOZKA_ZAKLADU = resolve(webRoot, 'drizzle')
export const SLOZKA_HISTORIE = resolve(webRoot, 'drizzle-historie')

/** Pomocné tabulky starých datových migrací; po převodu nemají význam. */
export const POMOCNE_TABULKY = [
  'migration_0006_approved_drafts',
  'migration_0011_vlastnictvi',
  'migration_0012_linked_questions',
  'migration_0014_approved_drafts',
]

export type VysledekMigrace = 'aktualni' | 'prevedeno'

export async function migrovat(
  client: Client,
  slozky: { zaklad?: string; historie?: string } = {},
): Promise<VysledekMigrace> {
  const zaklad = slozky.zaklad ?? SLOZKA_ZAKLADU
  const historie = slozky.historie ?? SLOZKA_HISTORIE
  const [prvni] = readMigrationFiles({ migrationsFolder: zaklad })
  if (!prvni) throw new Error(`Ve složce ${zaklad} není žádná migrace.`)

  if (!(await jeStaraRada(client, prvni.folderMillis))) {
    await migrate(drizzle(client), { migrationsFolder: zaklad })
    return 'aktualni'
  }

  // Stará řada: nejdřív ji dotáhnout do konce, ať se srovnává se stejným stavem.
  await migrate(drizzle(client), { migrationsFolder: historie })

  const cista = createClient({ url: ':memory:' })
  try {
    // Srovnává se jen se základem: migrace, které přibyly po něm, se pustí
    // až po převodu. Kdyby šly do srovnání i ony, stará databáze by jejich
    // sloupce postrádala a převod by skončil jako „neopravitelný“.
    await cista.migrate(prvni.sql)
    const rozdily = rozdilySchemat(await popisSchematu(cista), await popisSchematu(client))

    // Chybějící nebo přebývající tabulku či sloupec převod neopraví — to by
    // znamenalo domýšlet data. Jiný typ, výchozí hodnotu, cizí klíč nebo index
    // ano: tabulka se přestaví do přesného tvaru ze základu.
    const neopravitelne = rozdily.filter((r) => !r.opravitelny)
    if (neopravitelne.length > 0) {
      throw new Error(
        'Schéma databáze se liší od čistého základu tak, že převod nejde provést; nic se nezměnilo:\n' +
          neopravitelne.map((r) => `  - ${r.popis}`).join('\n'),
      )
    }
    await zkontrolovatCiziKlice(client, 'před převodem')

    const prestavet = [...new Set(rozdily.map((r) => r.tabulka))].sort()
    const prikazy: string[] = []
    for (const tabulka of prestavet) prikazy.push(...(await prestavba(cista, client, tabulka)))

    // Vše naráz a s vypnutými cizími klíči (`client.migrate`): přestavba
    // tabulky, na kterou jiné ukazují, by jinak neprošla, a polovičatý převod
    // nesmí zůstat.
    await client.migrate([
      ...prikazy,
      ...POMOCNE_TABULKY.map((tabulka) => `DROP TABLE IF EXISTS \`${tabulka}\``),
      'DELETE FROM `__drizzle_migrations`',
      {
        sql: 'INSERT INTO `__drizzle_migrations` ("hash", "created_at") VALUES (?, ?)',
        args: [prvni.hash, prvni.folderMillis],
      },
    ])

    await zkontrolovatCiziKlice(client, 'po převodu')
    const zbyle = rozdilySchemat(await popisSchematu(cista), await popisSchematu(client))
    if (zbyle.length > 0) {
      throw new Error(
        'Převod doběhl, ale schéma se od základu pořád liší — obnov databázi ze zálohy:\n' +
          zbyle.map((r) => `  - ${r.popis}`).join('\n'),
      )
    }
  } finally {
    cista.close()
  }

  // Po základu mohou přibýt další migrace; ty se pustí běžnou cestou.
  await migrate(drizzle(client), { migrationsFolder: zaklad })
  return 'prevedeno'
}

/**
 * Příkazy, které tabulku přestaví do tvaru ze základu (postup ze SQLite
 * dokumentace „Making Other Kinds Of Table Schema Changes"): nová tabulka pod
 * dočasným jménem, přelití dat, zahození staré, přejmenování, indexy.
 */
async function prestavba(cista: Client, client: Client, tabulka: string): Promise<string[]> {
  const ddl = await cista.execute({
    sql: "SELECT type, sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type = 'index'",
    args: [tabulka],
  })
  const vytvoreni = ddl.rows.find((r) => r.type === 'table')
  if (!vytvoreni) throw new Error(`Tabulka ${tabulka} v základu není.`)
  const docasna = `__prestavba_${tabulka}`
  const sloupce = (await cista.execute(`PRAGMA table_info(\`${tabulka}\`)`)).rows
    .map((r) => `\`${r.name}\``)
    .join(', ')
  return [
    String(vytvoreni.sql).replace(`CREATE TABLE \`${tabulka}\``, `CREATE TABLE \`${docasna}\``),
    `INSERT INTO \`${docasna}\` (${sloupce}) SELECT ${sloupce} FROM \`${tabulka}\``,
    `DROP TABLE \`${tabulka}\``,
    `ALTER TABLE \`${docasna}\` RENAME TO \`${tabulka}\``,
    ...ddl.rows.filter((r) => r.type === 'index').map((r) => String(r.sql)),
  ]
}

async function zkontrolovatCiziKlice(client: Client, kdy: string): Promise<void> {
  const porusene = await client.execute('PRAGMA foreign_key_check')
  if (porusene.rows.length === 0) return
  const ukazka = porusene.rows
    .slice(0, 5)
    .map((r) => `${r.table} (řádek ${r.rowid}) → ${r.parent}`)
    .join(', ')
  throw new Error(`Cizí klíče nesedí ${kdy}: ${porusene.rows.length}× — např. ${ukazka}.`)
}

interface Rozdil {
  tabulka: string
  popis: string
  opravitelny: boolean
}

const DRUHY = ['tabulka', 'sloupec', 'cizí klíč', 'index'] as const

function rozdilySchemat(ocekavane: Map<string, string>, skutecne: Map<string, string>): Rozdil[] {
  const rozdily: Rozdil[] = []
  for (const klic of new Set([...ocekavane.keys(), ...skutecne.keys()])) {
    const a = ocekavane.get(klic)
    const b = skutecne.get(klic)
    if (a === b) continue
    const druh = DRUHY.find((d) => klic.startsWith(`${d} `))!
    const predmet = klic.slice(druh.length + 1)
    const tabulka = druh === 'index' ? (JSON.parse(a ?? b!) as string[])[0]! : predmet.split('.')[0]!
    const popis =
      a === undefined ? `navíc ${klic}: ${b}` : b === undefined ? `chybí ${klic}: ${a}` : `jinak ${klic}: čeká se ${a}, je ${b}`
    const chybiNeboPrebyva = a === undefined || b === undefined
    rozdily.push({
      tabulka,
      popis,
      opravitelny: !(druh === 'tabulka' || (druh === 'sloupec' && chybiNeboPrebyva)),
    })
  }
  return rozdily
}

/** Čeká na databázi nějaká migrace (nebo převod)? Podle toho se dělá záloha. */
export async function cekaMigrace(client: Client, zaklad: string = SLOZKA_ZAKLADU): Promise<boolean> {
  const migrace = readMigrationFiles({ migrationsFolder: zaklad })
  const posledni = migrace.at(-1)
  if (!posledni) return false
  return (await posledniMigrace(client)) < posledni.folderMillis
}

/** Čas poslední zapsané migrace; `-1`, když databáze žádnou nemá. */
async function posledniMigrace(client: Client): Promise<number> {
  const tabulka = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  )
  if (tabulka.rows.length === 0) return -1
  const vysledek = await client.execute('SELECT MAX(created_at) AS cas FROM `__drizzle_migrations`')
  const cas = vysledek.rows[0]?.cas
  return cas === null || cas === undefined ? -1 : Number(cas)
}

/**
 * Stará řada = databáze už má schéma, ale poslední zapsaná migrace je starší
 * než základ. Prázdná databáze starou řadou není, ta dostane rovnou základ.
 */
async function jeStaraRada(client: Client, casZakladu: number): Promise<boolean> {
  const cas = await posledniMigrace(client)
  return cas >= 0 && cas < casZakladu
}

/** Rozdíly schématu oproti čisté databázi postavené ze základu, pro lidi. */
export async function porovnatSeZakladem(client: Client, zaklad: string = SLOZKA_ZAKLADU): Promise<string[]> {
  const cista = createClient({ url: ':memory:' })
  try {
    await migrate(drizzle(cista), { migrationsFolder: zaklad })
    return rozdilySchemat(await popisSchematu(cista), await popisSchematu(client)).map((r) => r.popis)
  } finally {
    cista.close()
  }
}

/**
 * Schéma jako mapa „co → popis": sloupce (typ, NOT NULL, výchozí hodnota,
 * primární klíč), cizí klíče a indexy. Pořadí sloupců se nesrovnává — sloupec
 * přidaný přes ALTER TABLE je vždycky na konci, a na chování to nemá vliv.
 */
async function popisSchematu(client: Client): Promise<Map<string, string>> {
  const popis = new Map<string, string>()
  const tabulky = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
      "AND name != '__drizzle_migrations' AND name NOT LIKE 'migration_0%' ORDER BY name",
  )
  for (const { name } of tabulky.rows) {
    const tabulka = String(name)
    popis.set(`tabulka ${tabulka}`, 'ano')

    const sloupce = await client.execute(`PRAGMA table_info(\`${tabulka}\`)`)
    for (const s of sloupce.rows) {
      popis.set(
        `sloupec ${tabulka}.${s.name}`,
        JSON.stringify([String(s.type).toLowerCase(), s.notnull, s.dflt_value, s.pk]),
      )
    }

    const klice = await client.execute(`PRAGMA foreign_key_list(\`${tabulka}\`)`)
    for (const k of klice.rows) {
      popis.set(
        `cizí klíč ${tabulka}.${k.from}`,
        JSON.stringify([k.table, k.to, String(k.on_delete).toLowerCase()]),
      )
    }

    const indexy = await client.execute(`PRAGMA index_list(\`${tabulka}\`)`)
    for (const i of indexy.rows) {
      // Automatické indexy (primární klíč, UNIQUE ve sloupci) se jmenují podle
      // pořadí vzniku, takže se srovnávají jen ty pojmenované.
      if (String(i.name).startsWith('sqlite_autoindex_')) continue
      const sloupceIndexu = await client.execute(`PRAGMA index_info(\`${i.name}\`)`)
      popis.set(
        `index ${i.name}`,
        JSON.stringify([tabulka, i.unique, sloupceIndexu.rows.map((r) => r.name)]),
      )
    }
  }
  return popis
}
