import { puzzleKindLabel, type PuzzleKind } from '../../schema/puzzle'
import { describeGradeAudience } from './questions'

export interface PuzzleWordsRequest {
  /**
   * Text of the topic's materials (the whole group, not one file). Files are
   * separated by a `=== name ===` header; the character budget is split
   * among materials by it (`fitMaterials`).
   */
  text: string
  topicName: string
  subjectName: string
  /** E.g. "8. ročník"; affects the choice of terms and the language of clues. */
  gradeName: string | null
  /** How many pairs to return. */
  count: number
  kind: PuzzleKind
  /** Words already in the puzzle — the model should supply different ones. */
  avoid?: string[]
  /**
   * Hidden sentence (cryptogram only). Without it the model does not know
   * which letters the words should contain, and the cryptogram often cannot
   * be built from the supplied words at all.
   */
  phrase?: string
  /** Word search grid size; determines the longest word. */
  grid?: { cols: number; rows: number }
}

/** Limits stated in the prompt; computed by `puzzleWordLimits` from the request. */
export interface PuzzleWordsPromptLimits {
  minLetters: number
  maxLetters: number
  /** Clue length requested from the model. */
  clueTarget: number
  /** Hard clue limit from the schema. */
  clueMax: number
}

/** Cryptogram letters still lacking a word, with counts (`Ř` → 1). */
export type MissingLetters = { letter: string; count: number }[]

export function buildPuzzleWordsSystemPrompt(gradeName: string | null, limits: PuzzleWordsPromptLimits): string {
  const audience = describeGradeAudience(gradeName)
  // Whatever can be checked in code (word in the material, diacritics,
  // revealing clue, lengths, repeats) is checked in code (`filterEntries`).
  // The prompt says it too, so the model does not return words that get dropped.
  return [
    'Jsi zkušený učitel na české základní škole a chystáš dětem hlavolam z probrané látky.',
    '',
    `Hlavolam luští ${audience}. Pojmy i nápovědy vybírej podle ročníku, ne podle odbornosti materiálu:`,
    'ber klíčové pojmy, které má žák toho věku z látky znát, a nápovědu piš slovy, kterým rozumí.',
    '',
    'Pravidla, která platí bez výjimky:',
    '1. Každé slovo musí v dodaném materiálu opravdu stát. Nepřidávej pojmy, které v něm nejsou — slovo, které v materiálu nenajdeme, se zahodí.',
    '2. Slovo piš česky se všemi háčky a čárkami přesně jako v materiálu (žaludek, jícen, křemen, dvanáctník, Ústava).',
    '   Slovo bez diakritiky (zaludek, jicen, kremen) je chyba.',
    '3. Každá položka `word` je právě jedno podstatné jméno v 1. pádě jednotného čísla: „kořen", ne „kořeny" ani „kořenem";',
    '   „výtrusnice", ne „výtrusnic". Množné číslo jen u slov, která jednotné nemají (plíce, játra).',
    '   Nikdy neuváděj sousloví ani více slov. Slovo nesmí obsahovat mezery, pomlčky, spojovníky ani číslice.',
    `4. Slovo má ${limits.minLetters} až ${limits.maxLetters} písmen; delší slova vynech.`,
    `5. Nápověda je jedna krátká školní věta nebo opis do ${limits.clueTarget} znaků (nikdy víc než ${limits.clueMax}),`,
    '   ze které žák slovo uhodne. Neodkazuj v ní na obrázky ani na strany materiálu.',
    '6. Nápověda nesmí obsahovat hledané slovo ani slovo od něj odvozené (u slova „kořen" nepiš „kořenový" ani „kořeny").',
    '7. Nápověda musí vést k jedinému slovu ze seznamu; žádné dvě nápovědy nejsou stejné a nepoužívej obecné definice, na které by sedělo víc slov.',
    '8. Slova se neopakují a neliší se jen tvarem téhož pojmu.',
    '9. Nevymýšlej vlastní názvy, zkratky, čísla ani odpovědi, které v materiálu nejsou.',
  ].join('\n')
}

export function buildPuzzleWordsPrompt(
  request: PuzzleWordsRequest,
  options: { count: number; text: string; missingLetters?: MissingLetters },
): string {
  const sections = [
    `Předmět: ${request.subjectName}`,
    `Ročník: ${request.gradeName ?? 'neurčen'} (luští ${describeGradeAudience(request.gradeName)})`,
    `Téma: ${request.topicName}`,
    `Hlavolam: ${puzzleKindLabel(request.kind)}`,
    '',
    `Vyber přesně ${options.count} klíčových pojmů tématu a ke každému napiš nápovědu.`,
  ]
  if (request.kind === 'cryptogram') {
    sections.push(
      'U tajenky se slova píšou do políček podle nápovědy, proto musí být nápověda jednoznačná — na otázku smí sedět jediné slovo.',
      'Nápověda nesmí obsahovat hledané slovo ani jeho část a musí fungovat samostatně bez znalosti pořadí v seznamu.',
    )
    const phrase = request.phrase?.trim()
    if (phrase) {
      sections.push(
        '',
        `Tajenka (věta, která se složí z písmen ve slovech): „${phrase}"`,
        'Na každé písmeno tajenky připadne jedno slovo, které to písmeno obsahuje. Každé slovo proto musí obsahovat',
        'aspoň jedno písmeno tajenky. Písmeno s diakritikou je jiné písmeno: na „Á" nestačí slovo s „A".',
      )
      if (options.missingLetters?.length) {
        const list = options.missingLetters.map(({ letter, count }) => (count > 1 ? `${letter} ×${count}` : letter)).join(', ')
        sections.push(
          `Písmena, pro která ještě chybí slovo: ${list}.`,
          'Pro každé písmeno ze seznamu dodej aspoň jedno slovo, které ho obsahuje (u „×2" aspoň dvě různá slova).',
          'Začni vzácnými písmeny s háčkem nebo čárkou — na ně se slovo hledá nejhůř. Až potom přidej další slova.',
        )
      }
    }
  }
  if (request.avoid?.length) {
    sections.push('', 'Tahle slova už v hlavolamu jsou, vyber jiná (ani jiný tvar téhož slova):', ...request.avoid.map((word) => `- ${word}`))
  }
  sections.push('', 'Materiál:', '"""', options.text, '"""')
  return sections.join('\n')
}
