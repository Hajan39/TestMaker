import { QUESTION_TYPE_LABELS, type QuestionType } from '../schema/question'

export interface GenerationRequest {
  /** Text materiálu. */
  text: string
  topicName: string
  subjectName: string
  /** Např. "8. ročník"; ovlivňuje jazykovou úroveň. */
  gradeName: string | null
  count: number
  types: QuestionType[]
  /** 1 = lehké, 2 = střední, 3 = těžké, 'mix' = rozloženo. */
  difficulty: 1 | 2 | 3 | 'mix'
  /** Volitelný vzor stylu (ukázka testu učitelky). */
  styleSample?: string
  /** Zadání, kterým se má generování vyhnout (už existující otázky). */
  avoid?: string[]
}

const TYPE_HINTS: Record<QuestionType, string> = {
  open: 'Volná odpověď na 2–6 řádků; v `answer` uveď vzorovou odpověď, ne jen heslo.',
  short_answer: 'Odpověď je jedno slovo, pojem nebo číslo. Do `acceptedAnswers` dej běžné varianty.',
  single_choice: 'Právě jedna možnost je správná. Distraktory musí být věcně blízké, ne zjevně nesmyslné.',
  multi_choice: 'Správné jsou 2–3 možnosti z 4–6. Nikdy ne všechny.',
  true_false: '4–6 tvrzení, přibližně půl na půl pravdivých a nepravdivých.',
  fill_blank: 'Souvislý text s ___ na místě vynechaných výrazů. Počet ___ musí přesně odpovídat poli `blanks`.',
  matching: 'Dva sloupce stejné délky (4–6 položek). `pairs` obsahuje dvojice indexů.',
  ordering:
    'Posloupnost, vývoj, cesta látky. `items` vypiš v libovolném pořadí a do `correctOrder` dej indexy do `items` udávající skutečně správné pořadí — odděl si tak "co vypsat" od "v jakém pořadí to patří za sebe". Aplikace položky pro tisk stejně zamíchá.',
  table_fill: 'Tabulka s hlavičkou; buňky k doplnění zapiš jako null a jejich správné hodnoty dej do `answers` po řádcích.',
  label_image: 'Nepoužívej — obrázky se ve fázi 1 negenerují.',
}

/**
 * Kolik zadání se vejde do seznamu „těmhle otázkám se vyhni".
 *
 * Seznam se ořezává, aby prompt nenarůstal do nekonečna u témat s dlouhou
 * historií generování — 40 položek stačilo, dokud šly první ty starší
 * z databáze. Volající dává napřed nově vzniklé otázky z běžícího generování
 * (viz generate.ts), takže při tématu s desítkami existujících otázek se do 40
 * nevešly ani ty čerstvé z právě běžící dávky.
 *
 * Podle téhož čísla si volající (`loadAvoidPrompts` ve webu) načítá otázky
 * z databáze — jinak by vybíral víc, než se do promptu vejde, a o tom, které
 * zahodit, by rozhodovalo pořadí řádků v databázi.
 */
export const AVOID_LIMIT = 80

/**
 * Delší zadání by prompt prodražilo neúměrně k přínosu — pro odlišení
 * duplicity stačí začátek.
 */
const AVOID_ITEM_MAX_LEN = 100

function truncateAvoidItem(text: string): string {
  return text.length > AVOID_ITEM_MAX_LEN ? `${text.slice(0, AVOID_ITEM_MAX_LEN)}…` : text
}

export function buildSystemPrompt(): string {
  return [
    'Jsi zkušený učitel na české základní škole a tvoříš otázky do písemek.',
    '',
    'Pravidla, která platí bez výjimky:',
    '1. Vycházej výhradně z dodaného materiálu. Nikdy nepřidávej fakta, která v něm nejsou.',
    '2. Pokud materiál něco zmiňuje jen okrajově, otázku na to netvoř.',
    '3. Každá otázka má jednu jednoznačně správnou odpověď doloženou v materiálu.',
    '4. Piš spisovnou češtinou, kterou žák daného ročníku bez potíží přečte.',
    '5. Formuluj zadání stručně a konkrétně. Vyhýbej se vatě typu "Popiš vlastními slovy vše, co víš o…".',
    '6. Otázky se nesmějí obsahově překrývat ani opakovat totéž jinými slovy.',
    '7. Do `explanation` napiš krátké zdůvodnění pro klíč učitele (jedna věta).',
    '8. Rozlož otázky po celém materiálu, ne jen po jeho začátku.',
    '9. Nepoužívej odkazy na "obrázek na slidu" ani na číslování stránek zdroje.',
    '10. Ke každé otázce vyplň evidence: název souboru ze záhlaví === … === a doslovnou větu z materiálu, o kterou se správná odpověď opírá.',
    '11. Drž se zadaného typu otázky. Možnosti k výběru patří jedině do pole `options`; do textu zadání je nikdy nevypisuj jako "a) … b) … c) …". Když má otázka nabízet možnosti, musí mít typ s výběrem.',
  ].join('\n')
}

export function buildUserPrompt(request: GenerationRequest): string {
  const gradeLine = request.gradeName ? `Ročník: ${request.gradeName}` : 'Ročník: neurčen'
  const difficultyLine =
    request.difficulty === 'mix'
      ? 'Obtížnost: promíchej lehké, střední i těžké otázky (zhruba 1/3 každé).'
      : `Obtížnost: ${request.difficulty} (1 = lehká, 2 = střední, 3 = těžká) u všech otázek.`

  // `request.types` může obsahovat opakování — každý výskyt typu je jedna
  // požadovaná otázka toho typu v této dávce (viz rozdělení typů mezi dávky
  // v generate.ts). Sečtením dostaneme přesný počet na typ místo obecného
  // "rozděl rovnoměrně", které při pár otázkách na devět typů nedávalo smysl.
  const typeCounts = new Map<QuestionType, number>()
  for (const t of request.types) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  const typeLines = [...typeCounts.entries()].map(
    ([t, n]) => `- ${t} (${QUESTION_TYPE_LABELS[t]}) × ${n}: ${TYPE_HINTS[t]}`,
  )

  const sections = [
    `Předmět: ${request.subjectName}`,
    gradeLine,
    `Téma: ${request.topicName}`,
    '',
    `Vytvoř přesně ${request.count} otázek, v tomto počtu podle typu:`,
    ...typeLines,
    '',
    difficultyLine,
  ]

  if (request.avoid?.length) {
    sections.push(
      '',
      'Tyto otázky už existují, vytvoř jiné (ani parafráze):',
      ...request.avoid.slice(0, AVOID_LIMIT).map((q) => `- ${truncateAvoidItem(q)}`),
    )
  }

  if (request.styleSample) {
    sections.push(
      '',
      'Ukázka stylu, kterým učitelka zadává otázky (napodob formulace, ne obsah):',
      '"""',
      request.styleSample.slice(0, 4000),
      '"""',
    )
  }

  sections.push(
    '',
    'Materiál:',
    '"""',
    request.text,
    '"""',
  )

  return sections.join('\n')
}
