/**
 * Obnova ze zálohy na straně prohlížeče.
 *
 * Nahrávání podléhá stropu 4,5 MB na jeden požadavek (Vercel), takže se soubor
 * krájí tady: tabulka po tabulce, po dávkách, a posílá se na `/api/export`.
 * Pořadí tabulek drží sám soubor — záloha je zapsaná tak, že nadřazené
 * položky jsou dřív než ty, které se na ně odkazují, a JSON pořadí klíčů
 * zachovává.
 *
 * Schválně bez importu `lib/backup`: ten sahá na schéma databáze a do
 * prohlížeče nepatří.
 */

/** Řádek zálohy; co v něm je, řeší až server proti schématu. */
type Radek = Record<string, unknown>

export interface Zaloha {
  format: string
  verze: number
  vytvoreno?: string
  tabulky: Record<string, Radek[]>
}

export interface Prubeh {
  tabulka: string
  hotovo: number
  celkem: number
}

/** Kolik řádků nejvýš v jedné dávce. */
const DAVKA = 200

/**
 * Strop na velikost jedné dávky. Vercel pustí požadavek do 4,5 MB; dva
 * megabajty jsou dost velké sousto na to, aby obnova netrvala věčně, a pořád
 * s rezervou i pro hlavičky a nabobtnání JSONu.
 */
const MAX_BAJTU = 2_000_000

const FORMAT = 'testmaker-zaloha'

/**
 * Přečte a ověří soubor zálohy. Chyby jsou české a říkají, co se stalo —
 * nejčastěji se sem dostane úplně jiný soubor.
 */
export function prectiZalohu(text: string): Zaloha {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Soubor se nepodařilo přečíst — není to platný JSON. Vybrala jsi soubor zálohy?')
  }
  if (!data || typeof data !== 'object') throw new Error('Soubor zálohy je prázdný.')
  const zaloha = data as Partial<Zaloha>
  if (zaloha.format !== FORMAT) {
    throw new Error('Tohle není záloha TestMakeru. Vyber soubor, který jsi stáhla tlačítkem Stáhnout zálohu.')
  }
  if (!zaloha.tabulky || typeof zaloha.tabulky !== 'object') {
    throw new Error('Záloha je poškozená — chybí v ní obsah knihovny. Nejspíš se nestáhla celá.')
  }
  return { format: zaloha.format, verze: zaloha.verze ?? 1, vytvoreno: zaloha.vytvoreno, tabulky: zaloha.tabulky }
}

/** Kolik čeho záloha obsahuje — pro potvrzení před obnovou. */
export function poctyVZaloze(zaloha: Zaloha): Record<string, number> {
  const pocty: Record<string, number> = {}
  for (const [nazev, radky] of Object.entries(zaloha.tabulky)) {
    pocty[nazev] = Array.isArray(radky) ? radky.length : 0
  }
  return pocty
}

/**
 * Odkaz na jiný řádek téže tabulky — materiálu na originál téhož obsahu,
 * verze otázky na kořen. Dopisuje se, až je v cíli celá tabulka.
 */
type Odkaz =
  | { id: string; duplicateOfId: string; duplicateScore: number | null }
  | { id: string; variantOf: string }

/**
 * Nahraje zálohu zpátky do knihovny. Slučuje se podle `id`, nic se nemaže,
 * takže se tentýž soubor dá nahrát opakovaně, aniž by se cokoli zdvojilo.
 *
 * Vrací počty řádků, které server přijal — v rozhraní se z nich skládá výpis
 * „co se navezlo“.
 */
export async function obnovZeZalohy(
  zaloha: Zaloha,
  onPrubeh?: (prubeh: Prubeh) => void,
): Promise<Record<string, number>> {
  const navezeno: Record<string, number> = {}
  const odkazy = new Map<string, Odkaz[]>()

  for (const [tabulka, radky] of Object.entries(zaloha.tabulky)) {
    if (!Array.isArray(radky) || radky.length === 0) {
      navezeno[tabulka] = 0
      continue
    }
    let hotovo = 0
    onPrubeh?.({ tabulka, hotovo, celkem: radky.length })
    for (const davka of nakrajej(radky)) {
      const odpoved = await posli({ tabulka, radky: davka })
      hotovo += Number(odpoved.zapsano ?? 0)
      if (Array.isArray(odpoved.odkazy) && odpoved.odkazy.length > 0) {
        const tabulkove = odkazy.get(tabulka) ?? []
        tabulkove.push(...(odpoved.odkazy as Odkaz[]))
        odkazy.set(tabulka, tabulkove)
      }
      onPrubeh?.({ tabulka, hotovo, celkem: radky.length })
    }
    navezeno[tabulka] = hotovo
  }

  // Materiál označený jako duplicita ukazuje na jiný materiál, verze otázky
  // na svůj kořen; ten v cíli mohl při zápisu po dávkách ještě chybět, takže
  // se odkazy dopisují až teď.
  for (const [tabulka, seznam] of odkazy) {
    for (let i = 0; i < seznam.length; i += DAVKA) {
      await posli({ tabulka, odkazy: seznam.slice(i, i + DAVKA) })
    }
  }

  return navezeno
}

/** Rozdělí řádky na dávky podle počtu i podle velikosti v bajtech. */
function nakrajej(radky: Radek[]): Radek[][] {
  const davky: Radek[][] = []
  let aktualni: Radek[] = []
  let bajtu = 0
  for (const radek of radky) {
    const velikost = JSON.stringify(radek).length
    if (aktualni.length > 0 && (aktualni.length >= DAVKA || bajtu + velikost > MAX_BAJTU)) {
      davky.push(aktualni)
      aktualni = []
      bajtu = 0
    }
    aktualni.push(radek)
    bajtu += velikost
  }
  if (aktualni.length > 0) davky.push(aktualni)
  return davky
}

async function posli(telo: unknown): Promise<Record<string, unknown>> {
  const odpoved = await fetch('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(telo),
  })
  const data = (await odpoved.json().catch(() => null)) as Record<string, unknown> | null
  if (!odpoved.ok) {
    const hlaska = typeof data?.error === 'string' ? data.error : 'Obnova se nepovedla.'
    throw new Error(hlaska)
  }
  return data ?? {}
}

/**
 * České tvary názvů tabulek — jedna trojice (pro jednu, pro dvě až čtyři, pro
 * pět a víc), ze které se skloňuje v rozhraní i v přehledu přenosu. Učitelka
 * i majitel u přenosu čtou tatáž slova.
 */
export const TVARY_TABULEK: Record<string, readonly [string, string, string]> = {
  subjects: ['předmět', 'předměty', 'předmětů'],
  grades: ['ročník', 'ročníky', 'ročníků'],
  topics: ['téma', 'témata', 'témat'],
  materials: ['materiál', 'materiály', 'materiálů'],
  assets: ['příloha', 'přílohy', 'příloh'],
  questions: ['otázka', 'otázky', 'otázek'],
  puzzles: ['hlavolam', 'hlavolamy', 'hlavolamů'],
  templates: ['šablona', 'šablony', 'šablon'],
  tests: ['test', 'testy', 'testů'],
  test_items: ['položka testu', 'položky testů', 'položek testů'],
}

/** Tvary pro počet; u neznámé tabulky zbývá jen její název. */
export function tvaryTabulky(nazev: string): readonly [string, string, string] {
  return TVARY_TABULEK[nazev] ?? [nazev, nazev, nazev]
}

/** Název tabulky česky v množném čísle („materiály“) — popisek, ne počet. */
export function popisTabulky(nazev: string): string {
  return tvaryTabulky(nazev)[1]
}
