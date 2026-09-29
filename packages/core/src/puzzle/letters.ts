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

/**
 * Znaky, které se do buňky vůbec nezapisují (mezery, spojovníky, pomlčky,
 * tečky, uvozovky). Obyčejný spojovník z klávesnice `-` je tu zvlášť — rozsah
 * U+2010 až U+2015 pokrývá jen typografické pomlčky a spojovníky.
 */
const SEPARATORS = /[\s ‐-―\-_.,;:!?'"()„“”‚‘’«»]+/u

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
  // Text vložený z macOS nebo z PDF bývá v rozloženém tvaru (NFD): „ř" je
  // tam „r" a samostatný háček. Bez sjednocení by z něj bylo „R" a háček by
  // skončil mezi nepoužitelnými znaky.
  for (const part of word.normalize('NFC').trim().split(SEPARATORS)) {
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
  return splitPhrase(phrase).words
}

/**
 * Věta tajenky po slovech i se znaky, které se do políček zapsat nedají
 * (číslice, značky). Ty se do tajenky nedostanou — volající je musí ohlásit,
 * jinak by z „Rok 1348" potichu zbylo jen „ROK".
 */
export function splitPhrase(phrase: string): { words: string[][]; unusable: string[] } {
  const words: string[][] = []
  const unusable: string[] = []
  for (const part of phrase.normalize('NFC').trim().split(/\s+/u)) {
    const split = splitWord(part)
    unusable.push(...split.unusable)
    if (split.letters.length > 0) words.push(split.letters)
  }
  return { words, unusable }
}

/** Písmena bez háčků a čárek — pro porovnání, které diakritiku nerozlišuje. */
function baseLetters(text: string): string {
  return puzzleLetters(text).join('').normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Prozrazuje nápověda odpověď? Porovnává se bez ohledu na velikost písmen
 * a diakritiku („KOREN" v nápovědě ke „kořen" se počítá). U slov od čtyř
 * písmen stačí, když slovo nápovědy odpovědí začíná („lesníkem" ke
 * „lesník"); kratší se musí shodovat celé, jinak by „les" prozradilo
 * i „lesklý".
 */
export function clueRevealsWord(word: string, clue: string): boolean {
  const answer = baseLetters(word)
  if (answer.length < 2) return false
  return clue
    .normalize('NFC')
    .split(/[^\p{L}\p{M}]+/u)
    .map(baseLetters)
    .some((token) => (answer.length >= 4 ? token.startsWith(answer) : token === answer))
}

/** Co se má popsat učitelce, když se něco nepovedlo. */
export interface PuzzleProblem {
  /** Slovo nebo písmeno, kterého se potíž týká; prázdné u obecné potíže. */
  subject?: string
  /** Věta česky, ze které je jasné, co s tím dělat. */
  message: string
}
