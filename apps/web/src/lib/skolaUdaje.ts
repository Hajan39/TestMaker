/**
 * Adresa a kontakty školy. Bez importů: čte je formulář v prohlížeči
 * i server, ať obě strany znají stejná pole se stejnými popisky.
 * Všechna jsou nepovinná — škola funguje i jen s názvem.
 */

export const UDAJE_SKOLY = [
  { klic: 'street', popisek: 'Ulice a číslo', placeholder: 'Školní 12' },
  { klic: 'city', popisek: 'Město', placeholder: 'Brno' },
  { klic: 'postalCode', popisek: 'PSČ', placeholder: '602 00' },
  { klic: 'website', popisek: 'Web', placeholder: 'www.skola.cz' },
  { klic: 'email', popisek: 'E-mail školy', placeholder: 'info@skola.cz' },
  { klic: 'phone', popisek: 'Telefon', placeholder: '+420 …' },
  { klic: 'ico', popisek: 'IČO', placeholder: '12345678' },
  { klic: 'principal', popisek: 'Ředitel/ka', placeholder: 'Mgr. Jana Nováková' },
] as const

export type KlicUdaje = (typeof UDAJE_SKOLY)[number]['klic']

/** Údaje tak, jak jsou ve formuláři: prázdný řetězec znamená „nevyplněno". */
export type UdajeSkoly = Record<KlicUdaje, string>

export const PRAZDNE_UDAJE: UdajeSkoly = Object.fromEntries(
  UDAJE_SKOLY.map((pole) => [pole.klic, '']),
) as UdajeSkoly

/**
 * Hodnota k uložení. Prázdná je `NULL`; web dostane `https://`, když ho
 * někdo napsal bez něj („www.skola.cz"), ať z něj jde udělat odkaz.
 */
export function normalizovatUdaj(klic: KlicUdaje, vstup: string | null | undefined): string | null {
  const hodnota = (vstup ?? '').trim()
  if (!hodnota) return null
  if (klic === 'website' && !/^https?:\/\//i.test(hodnota)) return `https://${hodnota}`
  return hodnota
}

/** Údaje z databázového řádku do formuláře. */
export function udajeZRadku(radek: { [K in KlicUdaje]: string | null }): UdajeSkoly {
  return Object.fromEntries(UDAJE_SKOLY.map((pole) => [pole.klic, radek[pole.klic] ?? ''])) as UdajeSkoly
}
