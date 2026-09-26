import { PUZZLE_KIND_LABELS, type PuzzleKind } from '../../schema/puzzle'
import { MAX_LETTERS, MIN_LETTERS } from '../puzzleWords'

export interface PuzzleWordsRequest {
  /** Text materiálů tématu (celá skupina, ne jeden soubor). */
  text: string
  topicName: string
  subjectName: string
  /** Např. „8. ročník"; ovlivňuje jazykovou úroveň nápověd. */
  gradeName: string | null
  /** Kolik dvojic se má vrátit. */
  count: number
  kind: PuzzleKind
  /** Slova, která už v hlavolamu jsou — model má dodat jiná. */
  avoid?: string[]
}

/** Nejdelší text materiálů, který se modelu posílá — na slovní zásobu stačí. */
const MAX_CHARS = 60_000

export function buildPuzzleWordsSystemPrompt(): string {
  return [
    'Jsi zkušený učitel na české základní škole a chystáš dětem hlavolam z probrané látky.',
    '',
    'Pravidla, která platí bez výjimky:',
    '1. Vycházej výhradně z dodaného materiálu. Nepřidávej pojmy, které v něm nejsou.',
    '2. Každá položka `word` musí být právě jedno samostatné slovo: jedno podstatné jméno v 1. pádě jednotného čísla.',
    '   Nikdy neuváděj sousloví ani více slov. Slovo nesmí obsahovat mezery, pomlčky, spojovníky ani číslice.',
    `3. Slovo má ${MIN_LETTERS} až ${MAX_LETTERS} písmen. Diakritiku piš normálně (list, kořen, chloroplast).`,
    '4. Nápověda je jedna krátká školní věta nebo opis, ze kterého žák slovo uhodne. Nikdy v ní slovo samo neuveď.',
    '5. Nápovědu napiš celou a srozumitelně; její délku neomezuj umělým zkracováním. Může zabrat celý řádek i více řádků a nepoužívá odkazy na obrázky ani na strany materiálu.',
    '6. Nápověda musí vést k jedinému slovu ze seznamu; nepoužívej obecné definice, na které by odpovídalo více slov.',
    '7. Slovo musí být doložitelné v dodaném materiálu a nápověda musí odpovídat jeho významu v tomto materiálu.',
    '8. Slova se neopakují a neliší se jen tvarem téhož pojmu.',
    '9. Nevymýšlej vlastní názvy, zkratky, čísla ani odpovědi, které v materiálu nejsou.',
  ].join('\n')
}

export function buildPuzzleWordsPrompt(request: PuzzleWordsRequest): string {
  const sections = [
    `Předmět: ${request.subjectName}`,
    request.gradeName ? `Ročník: ${request.gradeName}` : 'Ročník: neurčen',
    `Téma: ${request.topicName}`,
    `Hlavolam: ${PUZZLE_KIND_LABELS[request.kind]}`,
    '',
    `Vyber přesně ${request.count} klíčových pojmů tématu a ke každému napiš nápovědu.`,
  ]
  if (request.kind === 'cryptogram') {
    sections.push(
      'U tajenky se slova píšou do políček podle nápovědy, proto musí být nápověda jednoznačná — na otázku smí sedět jediné slovo.',
      'Nápověda nesmí obsahovat hledané slovo ani jeho část a musí fungovat samostatně bez znalosti pořadí v seznamu.',
    )
  }
  if (request.avoid?.length) {
    sections.push('', 'Tahle slova už v hlavolamu jsou, vyber jiná:', ...request.avoid.map((word) => `- ${word}`))
  }
  sections.push('', 'Materiál:', '"""', request.text.slice(0, MAX_CHARS), '"""')
  return sections.join('\n')
}
