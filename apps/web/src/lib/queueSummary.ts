import { OTAZKY, TEMAT_Z, TEMATA, pocet } from '@testmaker/ui'

/**
 * Jak dopadl běh fronty. Počítá se na dvou místech (přehled generování a panel
 * hromadného generování) a obě do téhle chvíle hlásila výsledek jinak — jedno
 * z nich chyby sbíralo, druhé je zahazovalo a po sedmi spadlých tématech
 * svítilo zeleně „Hotovo“. Věta i její vyznění vznikají proto tady, jednou.
 */
export interface BehFronty {
  /** Kolik témat se v běhu opravdu zpracovalo (povedená i nepovedená). */
  zpracovano: number
  /** Kolik z nich skončilo chybou. */
  chyby: number
  /** Kolik otázek celkem vzniklo. */
  otazky: number
}

/**
 * Vyznění výsledku. Odpovídá druhu hlášky: povedlo se všechno, něco spadlo,
 * spadlo všechno, nebo se nedělo vůbec nic.
 */
export type TonBehu = 'uspech' | 'varovani' | 'chyba' | 'nic'

export interface ShrnutiBehu {
  ton: TonBehu
  text: string
}

/**
 * Věta o výsledku běhu fronty. Počítá se jedním směrem — kolik témat se
 * povedlo a kolik ne; „hotovo × zbývá“ v jedné větě si navzájem odporovalo.
 */
export function shrnutiBehu({ zpracovano, chyby, otazky }: BehFronty): ShrnutiBehu {
  if (zpracovano === 0) {
    return { ton: 'nic', text: 'Fronta byla prázdná, nic se negenerovalo.' }
  }
  const povedena = Math.max(0, zpracovano - chyby)
  if (povedena === 0) {
    return {
      ton: 'chyba',
      text: `Nepovedlo se ani jedno téma. Nedokončeno: ${pocet(chyby, TEMATA)}.`,
    }
  }
  const hotovo = `Hotovo: ${pocet(otazky, OTAZKY)} z ${pocet(povedena, TEMAT_Z)}.`
  if (chyby === 0) return { ton: 'uspech', text: hotovo }
  return { ton: 'varovani', text: `${hotovo} Nedokončeno: ${pocet(chyby, TEMATA)}.` }
}
