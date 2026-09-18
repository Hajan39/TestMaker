/**
 * Písmena hlavolamu.
 *
 * Pravidlo je jednoduché a platí pro mřížku i pro tajenku: **jedno písmeno =
 * jedna buňka**. Česká písmena s háčky a čárkami se do buňky zapisují i s
 * diakritikou („Ř", „Ů"), takže „RAK" a „ŘÁD" nesdílejí ani jedno písmeno —
 * žák totiž hledá přesně to, co má napsané v seznamu.
 *
 * Spřežka `ch` se **záměrně nebere jako jedno písmeno**: v mřížce zabere dvě
 * buňky, C a H. V české abecedě je to sice jedno písmeno, ale osmisměrky se
 * tisknou po buňkách a učitelky i učebnice je takhle dělají — žák čte „c" a
 * „h" za sebou. Kdyby „ch" byla jedna buňka, musel by hledající poznat, kdy
 * se dvojice čte jako spřežka a kdy jako dvě písmena, a v mřížce to poznat
 * nejde.
 */

/** Znaky, které se do buňky vůbec nezapisují (mezery, spojovníky, tečky). */
const SEPARATORS = /[\s ‐-―_.,;:!?'"()]+/u

/** Je to písmeno, které se dá zapsat do buňky? */
export function isPuzzleLetter(char: string): boolean {
  return /^\p{L}$/u.test(char)
}

/**
 * Slovo rozložené na buňky: velká písmena, bez mezer a interpunkce.
 * Vrací i znaky, které se do mřížky zapsat nedají (čísla, značky) — volající
 * je hlásí učitelce místo toho, aby je tiše zahodil.
 */
export function splitWord(word: string): { letters: string[]; unusable: string[] } {
  const letters: string[] = []
  const unusable: string[] = []
  for (const part of word.trim().split(SEPARATORS)) {
    // `Intl`-nezávislé velké písmeno: čeština si vystačí s výchozím pravidlem.
    for (const char of part.toUpperCase()) {
      if (isPuzzleLetter(char)) letters.push(char)
      else if (char.trim()) unusable.push(char)
    }
  }
  return { letters, unusable }
}

/** Písmena slova do buněk; nepoužitelné znaky se vynechají. */
export function puzzleLetters(word: string): string[] {
  return splitWord(word).letters
}

/**
 * Věta tajenky rozložená na slova a ta na písmena. Mezery se do buněk
 * nezapisují, ale rozdělení na slova zůstává — tajenka se na papíře tiskne
 * po slovech, jinak by ji žák po vyluštění nepřečetl.
 */
export function phraseWords(phrase: string): string[][] {
  return phrase
    .trim()
    .split(/[\s ]+/u)
    .map((word) => puzzleLetters(word))
    .filter((letters) => letters.length > 0)
}

/** Co se má popsat učitelce, když se něco nepovedlo. */
export interface PuzzleProblem {
  /** Slovo nebo písmeno, kterého se potíž týká; prázdné u obecné potíže. */
  subject?: string
  /** Věta česky, ze které je jasné, co s tím dělat. */
  message: string
}
