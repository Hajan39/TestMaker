/*
 * Skloňování počtů — jediná definice pro celou aplikaci.
 *
 * Čeština má u počtů tři tvary a rozhraní je plné čísel: „1 téma“, „3 témata“,
 * „5 témat“. Dřív si tohle pravidlo napsala každá obrazovka po svém a všechny
 * kopie měly touž chybu — nula se počítala jako „2–4“, takže se v knihovně
 * svítilo „0 otázky“. Nula patří k tvaru pro pět a víc.
 */

/** Trojice tvarů: pro jednu, pro dvě až čtyři, pro pět a víc (a pro nulu). */
export type PluralForms = readonly [one: string, few: string, many: string]

/** Vybere správný tvar slova k počtu. Nula i záporná čísla berou tvar „mnoho“. */
export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one
  if (count >= 2 && count <= 4) return few
  return many
}

/** Počet i se slovem ve správném tvaru: „1 otázka“, „3 otázky“, „0 otázek“. */
export function pocet(count: number, forms: PluralForms): string {
  return `${count} ${plural(count, forms[0], forms[1], forms[2])}`
}

/** Tvary slov, která se v rozhraní počítají nejčastěji. */
export const OTAZKY: PluralForms = ['otázka', 'otázky', 'otázek']
export const TEMATA: PluralForms = ['téma', 'témata', 'témat']
export const MATERIALY: PluralForms = ['materiál', 'materiály', 'materiálů']
export const ROCNIKY: PluralForms = ['ročník', 'ročníky', 'ročníků']
