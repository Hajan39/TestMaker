/**
 * Společný základ pro obě cesty, jak dostat knihovnu jinam:
 *
 *   1. `scripts/push-remote.ts` — z počítače přímo do Tursa (databáze do databáze).
 *   2. `/api/export` — záloha do jednoho souboru JSON a obnova z něj.
 *
 * Obojí čte i zapisuje tytéž tabulky, ve stejném pořadí a stejným způsobem
 * (`insert … on conflict(id) do update`), aby se obě cesty chovaly shodně
 * a daly se opakovat. Nic se nikdy nemaže — sloučení je vždy podle `id`.
 *
 * Schválně tu nikde nefiguruje `@/db`: tenhle modul používá i skript spouštěný
 * přes `tsx`, kde se alias `@/` nerozřeší, a hlavně si musí umět sáhnout na
 * libovolnou databázi, ne jen na tu, nad kterou běží aplikace.
 */
import { and, asc, eq, getTableColumns, gt, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '../db/schema'

/** Databáze, nad kterou se pracuje — aplikace i skript posílají svou vlastní. */
export type BackupDb = LibSQLDatabase<typeof schema>

/** Jeden řádek tabulky tak, jak putuje v JSON. */
export type Radek = Record<string, unknown>

/**
 * Tabulky v pořadí, ve kterém se smějí zapisovat: co na co odkazuje, to už
 * v cíli musí být. Fronta generování (`generation_jobs`) se nepřenáší —
 * je to pracovní stav jednoho počítače, ne obsah knihovny, a na druhé straně
 * by jen strašila záznamy o bězích, které se tam nikdy nekonaly. Zpětná vazba
 * z přegenerování (`question_feedback`) se nepřenáší ze stejného důvodu —
 * je to telemetrie k přehledu „AI kvalita", ne obsah knihovny, a po obnově
 * by stejně ukazovala na jiná (nově vzniklá) id otázek.
 */
/**
 * Rozsah zálohy a obnovy: vždy jedna škola. Filtrovat po učitelkách nemá
 * smysl — částečný soubor by po obnově zanechal otázky bez témat. Obnova
 * navíc souboru nevěří: školu i vlastníky si přepíše podle toho, kdo obnovuje
 * (viz `zapisRadky`), jinak by nahraný soubor uměl zapsat řádky do cizí školy.
 */
export interface RozsahZalohy {
  schoolId: string
  /** Komu připadne obsah, jehož původní vlastník v cíli neexistuje. */
  userId: string
}

export const TABULKY = {
  subjects: schema.subjects,
  grades: schema.grades,
  topics: schema.topics,
  materials: schema.materials,
  assets: schema.assets,
  questions: schema.questions,
  puzzles: schema.puzzles,
  templates: schema.templates,
  prompt_rules: schema.promptRules,
  tests: schema.tests,
  test_items: schema.testItems,
} as const

export type NazevTabulky = keyof typeof TABULKY

/**
 * Tabulka bez jejího konkrétního tvaru — společný dotaz nad všemi tabulkami
 * jinak nejde napsat. Primární klíč `id` má každá z nich a jen na
 * něj se tu sahá jmenovitě.
 */
type Tabulka = SQLiteTable & { id: AnySQLiteColumn }

/** Tabulka podle názvu, v podobě, se kterou se dá pracovat obecně. */
function tabulka(nazev: NazevTabulky): Tabulka {
  return TABULKY[nazev] as unknown as Tabulka
}

/** Pořadí zápisu. `Object.keys` by typově sklouzlo na `string[]`. */
export const PORADI = Object.keys(TABULKY) as NazevTabulky[]

/** Značka formátu v souboru zálohy — ať je poznat, když se nahraje něco jiného. */
export const FORMAT = 'testmaker-zaloha'
export const VERZE = 1

/** Kolik řádků jde do jednoho `insert`. */
export const DAVKA = 200

/**
 * Strop na velikost jedné dávky. Materiály nesou plné texty; dvě stě dlouhých
 * PDF v jednom příkazu je zbytečně velké sousto pro spojení do Tursa.
 */
const MAX_DAVKA_BAJTU = 1_000_000

export function jeTabulka(name: string): name is NazevTabulky {
  return Object.prototype.hasOwnProperty.call(TABULKY, name)
}

/** Sloupce tabulky: klíč v JavaScriptu → název v databázi. */
function sloupce(nazev: NazevTabulky): Record<string, { name: string; columnType: string }> {
  return getTableColumns(tabulka(nazev)) as never
}

/** Sloupce, ve kterých je binární obsah (dnes jediný: `assets.data`). */
function binarniSloupce(nazev: NazevTabulky): string[] {
  return Object.entries(sloupce(nazev))
    .filter(([, column]) => column.columnType === 'SQLiteBlobBuffer')
    .map(([key]) => key)
}

/**
 * Řádek z databáze do podoby, kterou unese JSON. Jediné, co JSON neumí, jsou
 * binární přílohy — ty jdou v base64.
 */
export function doJson(nazev: NazevTabulky, row: Radek): Radek {
  const binarni = binarniSloupce(nazev)
  if (binarni.length === 0) return row
  const kopie: Radek = { ...row }
  for (const key of binarni) {
    const value = kopie[key]
    if (value instanceof Uint8Array) kopie[key] = Buffer.from(value).toString('base64')
  }
  return kopie
}

/**
 * Řádek z JSON zpátky do podoby pro zápis: zahodí sloupce, které schéma nezná
 * (starší nebo cizí soubor), a base64 přílohy převede zpět na binární data.
 * Sloupce, které v řádku nejsou, se nedoplňují — zapíší se výchozí hodnoty.
 */
export function zJson(nazev: NazevTabulky, row: Radek): Radek {
  const zname = sloupce(nazev)
  const binarni = new Set(binarniSloupce(nazev))
  const vysledek: Radek = {}
  for (const [key, value] of Object.entries(row)) {
    if (!Object.prototype.hasOwnProperty.call(zname, key)) continue
    if (value === undefined) continue
    vysledek[key] = binarni.has(key) && typeof value === 'string' ? Buffer.from(value, 'base64') : value
  }
  return vysledek
}

/**
 * Přiřazení pro `do update`: přepiš všechno kromě `id`. Díky tomu je zápis
 * opakovatelný — druhý běh tytéž řádky jen srovná, nezaloží podruhé a
 * nespadne na porušeném unikátním klíči.
 */
function prepis(nazev: NazevTabulky): Record<string, SQL> {
  const set: Record<string, SQL> = {}
  for (const [key, column] of Object.entries(sloupce(nazev))) {
    if (column.name === 'id') continue
    set[key] = sql.raw(`excluded."${column.name}"`)
  }
  return set
}

/** Odkaz materiálu na originál téhož obsahu — dopisuje se až nakonec. */
export interface OdkazDuplicity {
  id: string
  duplicateOfId: string
  duplicateScore: number | null
}

/**
 * Rozdělí dávku tak, aby ani jeden `insert` nebyl neúnosně velký. Počet řádků
 * je jen horní mez; u materiálů s dlouhými texty rozhoduje spíš velikost.
 */
function nakrajej(rows: Radek[], max = DAVKA): Radek[][] {
  const davky: Radek[][] = []
  let aktualni: Radek[] = []
  let bajtu = 0
  for (const row of rows) {
    const velikost = odhadniVelikost(row)
    if (aktualni.length > 0 && (aktualni.length >= max || bajtu + velikost > MAX_DAVKA_BAJTU)) {
      davky.push(aktualni)
      aktualni = []
      bajtu = 0
    }
    aktualni.push(row)
    bajtu += velikost
  }
  if (aktualni.length > 0) davky.push(aktualni)
  return davky
}

/** Hrubý odhad velikosti řádku; přesnost tu k ničemu není, jde jen o řád. */
function odhadniVelikost(row: Radek): number {
  let bajtu = 0
  for (const value of Object.values(row)) {
    if (typeof value === 'string') bajtu += value.length
    else if (value instanceof Uint8Array) bajtu += value.byteLength
    else if (value && typeof value === 'object') bajtu += JSON.stringify(value).length
    else bajtu += 8
  }
  return bajtu
}

export interface VysledekZapisu {
  zapsano: number
  /**
   * Odkazy na duplicity, které se musí dopsat, až budou v cíli všechny
   * materiály — viz `zapisOdkazyDuplicit`.
   */
  odkazy: OdkazDuplicity[]
}

/**
 * Zapíše (nebo srovná) řádky jedné tabulky.
 *
 * Materiály mají zvláštnost: `duplicate_of_id` ukazuje na jiný materiál v téže
 * tabulce, takže při zápisu po dávkách originál často ještě neexistuje. Odkazy
 * se proto v prvním průchodu vynechají a vrátí se volajícímu, aby je po
 * dokončení celé tabulky dopsal.
 */
export async function zapisRadky(
  db: BackupDb,
  nazev: NazevTabulky,
  rows: Radek[],
  rozsah: RozsahZalohy,
): Promise<VysledekZapisu> {
  if (rows.length === 0) return { zapsano: 0, odkazy: [] }

  // Účty, které v cíli opravdu jsou. Co v souboru ukazuje jinam (jiná škola,
  // dávno smazaná kolegyně), připadne tomu, kdo obnovu spustil — jinak by
  // obnova spadla na cizím klíči, nebo hůř, zapsala data pod cizí identitu.
  const znameUcty = new Set(
    (
      await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.schoolId, rozsah.schoolId))
    ).map((row) => row.id),
  )
  const kdo = (hodnota: unknown): string =>
    typeof hodnota === 'string' && znameUcty.has(hodnota) ? hodnota : rozsah.userId

  const odkazy: OdkazDuplicity[] = []
  const pripravene = rows.map((row) => {
    const hodnoty = zJson(nazev, row)
    if (typeof hodnoty.id !== 'string' || hodnoty.id.length === 0) {
      throw new Error(`Řádek tabulky ${nazev} nemá id — soubor nejspíš není záloha TestMakeru.`)
    }
    // Škola se přebírá z toho, kdo obnovuje, ne ze souboru.
    hodnoty.schoolId = rozsah.schoolId
    for (const sloupec of ['ownerId', 'requestedBy'] as const) {
      if (sloupec in hodnoty) hodnoty[sloupec] = kdo(hodnoty[sloupec])
    }
    for (const sloupec of ['createdBy', 'reviewedBy'] as const) {
      if (hodnoty[sloupec] != null) hodnoty[sloupec] = kdo(hodnoty[sloupec])
    }
    if (nazev === 'materials' && typeof hodnoty.duplicateOfId === 'string') {
      odkazy.push({
        id: hodnoty.id,
        duplicateOfId: hodnoty.duplicateOfId,
        duplicateScore: typeof hodnoty.duplicateScore === 'number' ? hodnoty.duplicateScore : null,
      })
      hodnoty.duplicateOfId = null
    }
    return hodnoty
  })

  const table = tabulka(nazev)
  const set = prepis(nazev)
  for (const davka of nakrajej(pripravene)) {
    try {
      await db
        .insert(table)
        .values(davka as never)
        .onConflictDoUpdate({ target: table.id, set })
    } catch (error) {
      // Dávka spadla celá, ale vinu na tom má jeden řádek. Projde se znovu po
      // jednom, aby šlo říct který — hláška ze SQLite sama o sobě neřekne nic,
      // s čím by se dalo něco dělat.
      for (const radek of davka) {
        await db
          .insert(table)
          .values(radek as never)
          .onConflictDoUpdate({ target: table.id, set })
          .catch((chyba: unknown) => {
            throw new Error(vysvetli(nazev, radek, chyba ?? error))
          })
      }
      throw error
    }
  }
  return { zapsano: pripravene.length, odkazy }
}

/**
 * Proč se řádek nezapsal, česky. Nejčastější případ zdaleka: v cíli už je
 * položka téhož jména, ale s jiným `id` — typicky když někdo mezitím založil
 * „PŘÍRODOPIS“ ručně i na druhé straně. Sloučit je podle jména nejde (jsou to
 * dvě různé věci se dvěma různými historiemi), takže se to musí rozhodnout
 * ručně.
 */
function vysvetli(nazev: NazevTabulky, radek: Radek, chyba: unknown): string {
  const detail = popisChyby(chyba)
  const jmeno = [radek.name, radek.title, radek.fileName, radek.slug].find(
    (hodnota) => typeof hodnota === 'string' && hodnota.length > 0,
  )
  const kdo = jmeno ? `„${String(jmeno)}“ (${String(radek.id)})` : String(radek.id)
  if (/unique/i.test(detail)) {
    return (
      `V tabulce ${nazev} už je položka se stejným názvem jako ${kdo}, ale s jiným id. ` +
      'Přejmenuj jednu z nich a spusť to znovu.'
    )
  }
  if (/foreign key/i.test(detail)) {
    return (
      `Položka ${kdo} v tabulce ${nazev} patří pod něco, co v cíli není — ` +
      'nejspíš se nepřenesla nadřazená položka. Spusť přenos celý znovu.'
    )
  }
  return `Položku ${kdo} v tabulce ${nazev} se nepodařilo zapsat: ${detail}`
}

/**
 * Text chyby i s tím, co ji způsobilo. Drizzle vlastní hlášku ze SQLite
 * (`UNIQUE constraint failed: …`) zabalí do `cause`, takže v `message` samotné
 * není a bez tohohle by se pod „něco se nepovedlo“ schovalo úplně všechno.
 */
function popisChyby(chyba: unknown): string {
  const casti: string[] = []
  let aktualni: unknown = chyba
  for (let hloubka = 0; aktualni instanceof Error && hloubka < 5; hloubka++) {
    casti.push(aktualni.message)
    aktualni = (aktualni as { cause?: unknown }).cause
  }
  return casti.length > 0 ? casti.join(' — ') : String(chyba)
}

/**
 * Dopíše odkazy materiálů na originál téhož obsahu. Odkaz na materiál, který
 * v cíli není (nepřenesl se, nebo se mezitím smazal), se tiše přeskočí —
 * lepší materiál navíc než spadlý přenos kvůli cizímu klíči.
 */
export async function zapisOdkazyDuplicit(db: BackupDb, odkazy: OdkazDuplicity[]): Promise<number> {
  let zapsano = 0
  for (const odkaz of odkazy) {
    const vysledek = await db.run(sql`
      update materials
      set duplicate_of_id = ${odkaz.duplicateOfId}, duplicate_score = ${odkaz.duplicateScore}
      where id = ${odkaz.id}
        and exists (select 1 from materials as orig where orig.id = ${odkaz.duplicateOfId})
    `)
    zapsano += Number(vysledek.rowsAffected ?? 0)
  }
  return zapsano
}

/**
 * Čte tabulku po dávkách, seřazenou podle `id`. Kurzor (ne `offset`) proto,
 * že se tím čte přes primární klíč a paměť drží vždy jen jednu dávku —
 * materiály i otázky nesou plné texty a celá knihovna se do ní vejít nemusí.
 */
export async function* citejTabulku(
  db: BackupDb,
  nazev: NazevTabulky,
  rozsah: { schoolId: string },
  davka = DAVKA,
): AsyncGenerator<Radek[]> {
  const table = tabulka(nazev)
  const skola = eq((table as unknown as { schoolId: AnySQLiteColumn }).schoolId, rozsah.schoolId)
  const vyber = await vyberSloupcu(db, nazev)
  // Prázdný výběr = na sloupce se zeptat nedalo; pak se čte celý řádek podle schématu.
  const uplny = Object.keys(vyber).length === 0
  let posledni: string | null = null
  for (;;) {
    const zaklad = uplny ? db.select() : db.select(vyber as never)
    const query = zaklad.from(table).orderBy(asc(table.id)).limit(davka)
    const rows = (await (posledni === null
      ? query.where(skola)
      : query.where(and(skola, gt(table.id, posledni))))) as Radek[]
    if (rows.length === 0) return
    yield rows
    posledni = rows[rows.length - 1]!.id as string
    if (rows.length < davka) return
  }
}

/**
 * Tabulky, které v dané databázi opravdu jsou. Stará záloha nebo databáze,
 * ve které ještě neproběhla poslední migrace, prostě některou tabulku nemá —
 * vyvážet se z ní nedá nic, ale to není důvod, aby celý běh spadl na
 * „no such table“.
 */
export async function existujiciTabulky(db: BackupDb): Promise<Set<NazevTabulky>> {
  const vysledek = await db.run(sql`select name from sqlite_master where type = 'table'`)
  const nalezene = new Set(vysledek.rows.map((row) => String(row.name)))
  return new Set(PORADI.filter((nazev) => nalezene.has(nazev)))
}

/**
 * Sloupce k vyčtení: jen ty, které v databázi opravdu jsou. Databáze o jednu
 * migraci pozadu (přibyl sloupec, ale ještě se nemigrovalo) by jinak shodila
 * celý běh na „no such column“ — a přitom z ní jde v pohodě vyvézt všechno
 * ostatní.
 */
async function vyberSloupcu(db: BackupDb, nazev: NazevTabulky): Promise<Record<string, unknown>> {
  // Kdyby se na sloupce zeptat nedalo, čte se prostě všechno podle schématu —
  // to je správně vždycky, když databáze není o migraci pozadu.
  const vysledek = await db
    .run(sql`select name from pragma_table_info(${nazev})`)
    .catch(() => null)
  if (!vysledek) return {}
  const jsou = new Set(vysledek.rows.map((row) => String(row.name)))
  const vyber: Record<string, unknown> = {}
  const table = tabulka(nazev) as unknown as Record<string, unknown>
  for (const [klic, column] of Object.entries(sloupce(nazev))) {
    if (jsou.has(column.name)) vyber[klic] = table[klic]
  }
  return vyber
}

export type Pocty = Record<NazevTabulky, number>

/** Kolik čeho v databázi je. Slouží k porovnání obou stran přenosu. */
export async function spocitej(db: BackupDb, rozsah: { schoolId: string }): Promise<Pocty> {
  const jsou = await existujiciTabulky(db)
  const pocty = prazdnePocty()
  for (const nazev of PORADI) {
    if (!jsou.has(nazev)) continue
    const table = tabulka(nazev)
    const [row] = await db
      .select({ value: sql<number>`count(*)` })
      .from(table)
      .where(eq((table as unknown as { schoolId: AnySQLiteColumn }).schoolId, rozsah.schoolId))
    pocty[nazev] = Number(row?.value ?? 0)
  }
  return pocty
}

/** Prázdné počty — hodí se jako výchozí hodnota při sčítání. */
export function prazdnePocty(): Pocty {
  const pocty = {} as Pocty
  for (const nazev of PORADI) pocty[nazev] = 0
  return pocty
}

/**
 * Záloha po kouscích textu. Skládá se ručně, protože celý soubor (dnes ~2,5 MB
 * a poroste) nemá smysl držet v paměti jen proto, aby se z něj udělal jeden
 * řetězec — odpověď tak může odtékat průběžně.
 */
export async function* zalohaKousky(
  db: BackupDb,
  rozsah: { schoolId: string },
): AsyncGenerator<string> {
  yield `{"format":${JSON.stringify(FORMAT)},"verze":${VERZE},"vytvoreno":${JSON.stringify(
    new Date().toISOString(),
  )},"tabulky":{`

  const jsou = await existujiciTabulky(db)
  let prvniTabulka = true
  for (const nazev of PORADI) {
    if (!jsou.has(nazev)) continue
    yield `${prvniTabulka ? '' : ','}${JSON.stringify(nazev)}:[`
    prvniTabulka = false
    let prvniRadek = true
    for await (const rows of citejTabulku(db, nazev, rozsah)) {
      const text = rows.map((row) => JSON.stringify(doJson(nazev, row))).join(',')
      yield prvniRadek ? text : `,${text}`
      prvniRadek = false
    }
    yield ']'
  }

  yield '}}'
}

/** Celá záloha jako jeden řetězec — pro testy a pro skript, ne pro odpověď. */
export async function zalohaText(db: BackupDb, rozsah: { schoolId: string }): Promise<string> {
  let text = ''
  for await (const kousek of zalohaKousky(db, rozsah)) text += kousek
  return text
}

/** Název staženého souboru: `testmaker-zaloha-2026-09-18.json`. */
export function nazevSouboru(kdy = new Date()): string {
  return `testmaker-zaloha-${kdy.toISOString().slice(0, 10)}.json`
}
