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
  ordering: 'Položky uveď ve správném pořadí (posloupnost, vývoj, cesta látky). Aplikace je při tisku zamíchá.',
  table_fill: 'Tabulka s hlavičkou; buňky k doplnění zapiš jako null a jejich správné hodnoty dej do `answers` po řádcích.',
  label_image: 'Nepoužívej — obrázky se ve fázi 1 negenerují.',
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
  ].join('\n')
}

export function buildUserPrompt(request: GenerationRequest): string {
  const gradeLine = request.gradeName ? `Ročník: ${request.gradeName}` : 'Ročník: neurčen'
  const difficultyLine =
    request.difficulty === 'mix'
      ? 'Obtížnost: promíchej lehké, střední i těžké otázky (zhruba 1/3 každé).'
      : `Obtížnost: ${request.difficulty} (1 = lehká, 2 = střední, 3 = těžká) u všech otázek.`

  const typeLines = request.types.map(
    (t) => `- ${t} (${QUESTION_TYPE_LABELS[t]}): ${TYPE_HINTS[t]}`,
  )

  const sections = [
    `Předmět: ${request.subjectName}`,
    gradeLine,
    `Téma: ${request.topicName}`,
    '',
    `Vytvoř přesně ${request.count} otázek. Rovnoměrně je rozděl mezi tyto typy:`,
    ...typeLines,
    '',
    difficultyLine,
  ]

  if (request.avoid?.length) {
    sections.push(
      '',
      'Tyto otázky už existují, vytvoř jiné (ani parafráze):',
      ...request.avoid.slice(0, 40).map((q) => `- ${q}`),
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
