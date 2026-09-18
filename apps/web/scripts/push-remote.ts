/**
 * Přenos hotové knihovny z počítače do provozní databáze (Turso).
 *
 *   TARGET_DATABASE_URL=libsql://…  TARGET_DATABASE_AUTH_TOKEN=…  \
 *     pnpm --filter @testmaker/web push:remote            # jen spočítá, nic nezapíše
 *     pnpm --filter @testmaker/web push:remote -- --zapsat
 *
 * Proč databáze rovnou do databáze, a ne přes aplikaci: požadavek na Vercelu
 * smí mít nejvýš 4,5 MB a funkce běží jen omezenou dobu. Tenhle skript běží
 * na počítači majitele, mluví s Tursem přímo a žádné takové stropy se ho
 * netýkají — 268 materiálů s plnými texty projde jedním během.
 *
 * Běh se dá kdykoli zopakovat: zapisuje se `insert … on conflict(id) do update`,
 * takže druhý běh nic nezdvojí, jen srovná, co se mezitím změnilo. Když se běh
 * přeruší v půlce, stačí ho spustit znovu.
 *
 * Fronta generování (`generation_jobs`) se nepřenáší — je to pracovní stav
 * jednoho počítače, ne obsah knihovny.
 */
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import {
  PORADI,
  citejTabulku,
  existujiciTabulky,
  prazdnePocty,
  spocitej,
  zapisOdkazyDuplicit,
  zapisRadky,
  type BackupDb,
  type NazevTabulky,
  type OdkazDuplicity,
} from '../src/lib/backup'
import { popisTabulky } from '../src/lib/backupClient'

const zapsat = process.argv.includes('--zapsat')
const dryRun = !zapsat || process.argv.includes('--dry-run')

/**
 * Cíl se schválně nebere z `DATABASE_URL`. Ta míří na zdroj (lokální soubor)
 * a kdyby se z ní bral i cíl, stačilo by zapomenout na jednu proměnnou
 * a skript by přepsal knihovnu sám sebou.
 */
const cilUrl = process.env.TARGET_DATABASE_URL
const cilToken = process.env.TARGET_DATABASE_AUTH_TOKEN
const zdrojUrl = process.env.SOURCE_DATABASE_URL || 'file:./local.db'

function konec(zprava: string): never {
  console.error(zprava)
  process.exit(1)
}

async function main() {
  if (!cilUrl) {
    konec(
      'Chybí TARGET_DATABASE_URL — adresa databáze, do které se má přenášet ' +
        '(v Tursu `turso db show <jméno> --url`). Spolu s ní obvykle i ' +
        'TARGET_DATABASE_AUTH_TOKEN.',
    )
  }
  if (cilUrl === zdrojUrl) {
    konec('TARGET_DATABASE_URL je totéž co zdroj — to by knihovna přepsala sama sebe.')
  }

  const zdrojKlient = createClient({ url: zdrojUrl })
  const cilKlient = createClient({ url: cilUrl, authToken: cilToken })
  const zdroj = drizzle(zdrojKlient, { schema }) as BackupDb
  const cil = drizzle(cilKlient, { schema }) as BackupDb

  console.log(`Zdroj: ${zdrojUrl}`)
  console.log(`Cíl:   ${cilUrl}`)
  console.log('')

  await overSchema(cil)

  const pred = await spocitej(cil)
  const zdrojovePocty = await spocitej(zdroj)

  if (dryRun) {
    console.log('Nanečisto (--dry-run): nic se nezapisuje.\n')
    vypisTabulku(zdrojovePocty, pred)
    console.log('\nSkutečný přenos spustíš s přepínačem --zapsat.')
    zdrojKlient.close()
    cilKlient.close()
    return
  }

  const veZdroji = await existujiciTabulky(zdroj)
  const preneseno = prazdnePocty()
  for (const nazev of PORADI) {
    if (!veZdroji.has(nazev)) {
      // Zdroj je starší než aplikace — tabulka v něm ještě není a přenášet
      // z ní není co.
      console.log(`${nazev}: ve zdroji není, přeskakuji`)
      continue
    }
    const odkazy: OdkazDuplicity[] = []
    let hotovo = 0
    for await (const davka of citejTabulku(zdroj, nazev)) {
      const vysledek = await zapisRadky(cil, nazev, davka)
      odkazy.push(...vysledek.odkazy)
      hotovo += vysledek.zapsano
      if (zdrojovePocty[nazev] > 0) prubeh(`${nazev}: ${hotovo}/${zdrojovePocty[nazev]}`)
    }
    preneseno[nazev] = hotovo
    let dopsano = 0
    if (odkazy.length > 0) dopsano = await zapisOdkazyDuplicit(cil, odkazy)
    if (zdrojovePocty[nazev] > 0) {
      hotovoRadek(
        `${nazev}: ${hotovo}/${zdrojovePocty[nazev]}` +
          (odkazy.length > 0 ? ` (duplicity: ${dopsano})` : ''),
      )
    }
  }

  console.log('')
  const po = await spocitej(cil)
  vypisTabulku(zdrojovePocty, po, preneseno)

  const chybi = PORADI.filter((nazev) => po[nazev] < zdrojovePocty[nazev])
  if (chybi.length > 0) {
    console.log(
      `\nV cíli je míň řádků než ve zdroji (${chybi.join(', ')}). Spusť přenos znovu; ` +
        'opakovaný běh nic nezdvojí.',
    )
  } else {
    console.log('\nHotovo. V cíli je všechno, co je ve zdroji.')
  }

  zdrojKlient.close()
  cilKlient.close()
}

/**
 * Průběh dlouhé tabulky. V terminálu se řádek přepisuje, v přesměrovaném
 * výstupu (log z běhu) by z toho byla nečitelná kaše, tak se tam mlčí a
 * vypíše se až hotová tabulka.
 */
function prubeh(text: string): void {
  if (process.stdout.isTTY) process.stdout.write(`\r${text}   `)
}

/** Dokončená tabulka — vypíše se vždycky, i do souboru. */
function hotovoRadek(text: string): void {
  if (process.stdout.isTTY) process.stdout.write('\r')
  console.log(`${text}   `)
}

/**
 * Cílová databáze musí mít schéma — migrace tam pouští GitHub Actions
 * (`.github/workflows/migrate.yml`), ne tenhle skript. Bez téhle kontroly by
 * přenos spadl uprostřed na nesrozumitelné „no such table“.
 */
async function overSchema(cil: BackupDb): Promise<void> {
  const vysledek = await cil.run(sql`select name from sqlite_master where type = 'table'`)
  const tabulky = new Set(vysledek.rows.map((row) => String(row.name)))
  const chybi = PORADI.filter((nazev) => !tabulky.has(nazev))
  if (chybi.length > 0) {
    konec(
      `V cílové databázi chybí tabulky (${chybi.join(', ')}). Nejdřív tam pusť migrace — ` +
        've workflow „migrate“ na GitHubu, nebo z počítače:\n' +
        '  DATABASE_URL=$TARGET_DATABASE_URL DATABASE_AUTH_TOKEN=$TARGET_DATABASE_AUTH_TOKEN \\\n' +
        '    pnpm --filter @testmaker/web db:migrate',
    )
  }
}

/** Přehled „co je ve zdroji / co je v cíli“, ať je na první pohled vidět rozdíl. */
function vypisTabulku(
  zdroj: Record<NazevTabulky, number>,
  cil: Record<NazevTabulky, number>,
  preneseno?: Record<NazevTabulky, number>,
): void {
  const sirka = Math.max(...PORADI.map((nazev) => popisTabulky(nazev).length))
  console.log(
    `${'tabulka'.padEnd(sirka)}  ${'zdroj'.padStart(7)}  ${'cíl'.padStart(7)}` +
      (preneseno ? `  ${'posláno'.padStart(7)}` : ''),
  )
  for (const nazev of PORADI) {
    console.log(
      `${popisTabulky(nazev).padEnd(sirka)}  ${String(zdroj[nazev]).padStart(7)}  ` +
        `${String(cil[nazev]).padStart(7)}` +
        (preneseno ? `  ${String(preneseno[nazev]).padStart(7)}` : ''),
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
