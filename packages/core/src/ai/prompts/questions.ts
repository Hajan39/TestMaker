import { questionTypeLabel, type QuestionType } from '../../schema/question'
import { AI_SETTINGS } from '../settings'

export interface GenerationRequest {
  /** Material text. */
  text: string
  topicName: string
  subjectName: string
  /** E.g. "8. ročník"; affects the language level. */
  gradeName: string | null
  count: number
  types: QuestionType[]
  /** 1 = easy, 2 = medium, 3 = hard, 'mix' = spread. */
  difficulty: 1 | 2 | 3 | 'mix'
  /** Optional style sample (an example of the teacher's test). */
  styleSample?: string
  /** Prompts generation should avoid (already existing questions). */
  avoid?: string[]
  /**
   * Quote (`evidence.quote`) of the question being replaced. When set,
   * generation uses the chunk containing that quote — the replacement should
   * cover the same subject matter.
   */
  focus?: string
  /**
   * Why the teacher rejected the question being replaced
   * (`REGENERATE_REASONS[reason].hint`) and her optional own note. The note
   * goes into the prompt as a quotation, not as an instruction — otherwise
   * anything could be written into it and the model would take it as another
   * rule.
   */
  replacementReason?: { hint: string; note?: string }
  /**
   * Request for an easier or harder version of an existing question, not a
   * regeneration. The model must create a different question on the same
   * subject matter — so it also gets the original prompt for comparison, to
   * avoid the same question in other words.
   */
  variantOf?: { direction: 'easier' | 'harder'; originalPrompt: string }
  /**
   * Rules the school added itself in Management (`promptRules`, active
   * only). They are created by the admin explicitly saving a recurring
   * regeneration reason — never added automatically.
   */
  schoolRules?: string[]
}

/** Longest teacher note that fits into the prompt — longer ones are trimmed. */
export const MAX_REPLACEMENT_NOTE_LENGTH = 300

export const QUESTION_TYPE_HINTS: Record<QuestionType, string> = {
  open:
    'Jen když má materiál stručnou věcnou odpověď, ne názor. 2–6 řádků; v `answer` napiš vzorovou odpověď k opravování, ne jen heslo. `points` 2–4 podle toho, kolik věcí má odpověď obsahovat.',
  draw:
    'Jen když jde látku nakreslit a popsat (stavba, schéma, pokus, mapa). Zadání řekne, co nakreslit a které části popsat. 6–12 řádků místa; v `answer` vypiš, co musí kresba obsahovat a které popisky. `points` 2–4 podle počtu popisků.',
  short_answer: 'Odpověď je jedno slovo nebo krátké sousloví z materiálu. Do `acceptedAnswers` dej běžné varianty.',
  single_choice: 'Čtyři možnosti, právě jedna správná. `correctIndex` je pořadí správné možnosti od nuly.',
  multi_choice:
    '4 možnosti; správná může být jedna, dvě, tři i všechny — počet mezi otázkami střídej, ať ho žák nemůže uhodnout. Zadání řekne, ať žák označí všechny správné možnosti, ale neprozradí kolik jich je. Špatné možnosti věrohodné, ne nesmyslné. Žádná možnost se neopakuje.',
  true_false: '4 krátká tvrzení, zhruba půl pravdivých. Nepravdivé tvrzení vznikne malou změnou pravdivého.',
  fill_blank:
    '1–4 vynechaná slova; počet ___ v textu přesně odpovídá poli `blanks`; vynechávej klíčové pojmy z materiálu, ne nahodilá slova.',
  matching:
    '4–6 dvojic; levý a pravý sloupec stejně dlouhé; `pairs` obsahuje dvojice indexů [levý, pravý], každý index právě jednou; pravý sloupec vypiš v jiném pořadí než levý.',
  ordering:
    'Posloupnost, vývoj, cesta látky. 3–5 položek, počet mezi otázkami střídej. `items` vypiš v libovolném pořadí a do `correctOrder` dej indexy do `items` udávající skutečně správné pořadí — odděl si tak "co vypsat" od "v jakém pořadí to patří za sebe". Aplikace položky pro tisk stejně zamíchá.',
  table_fill: 'Tabulka s hlavičkou; buňky k doplnění zapiš jako null a jejich správné hodnoty dej do `answers` po řádcích.',
  label_image: 'Nepoužívej — obrázky se ve fázi 1 negenerují.',
}

function truncateAvoidItem(text: string): string {
  return text.length > AI_SETTINGS.avoidItemMaxLength
    ? `${text.slice(0, AI_SETTINGS.avoidItemMaxLength)}…`
    : text
}

/**
 * Who the questions are written for. The teacher's materials are often more
 * technical than what the pupil should know (university textbooks, research
 * articles), and without this guidance the model follows the difficulty of
 * the text, not the grade — then a sixth-grade biology question on cellular
 * respiration comes out with university terms.
 *
 * The age is derived from the number at the start of the grade name
 * (`8. ročník`), like the grade order in the library. Without a number or a
 * grade a generic primary-school pupil remains: the worst guess that cannot
 * break anything, because it still keeps the model below secondary level.
 */
export function describeGradeAudience(gradeName: string | null | undefined): string {
  const match = gradeName ? /^\s*(\d+)/.exec(gradeName) : null
  const grade = match ? Number(match[1]) : null
  if (grade === null || grade < 1 || grade > 9) return 'žák základní školy'
  // First grade starts at six, each next one a year older.
  return `žák ${grade}. ročníku základní školy (${grade + 5}–${grade + 6} let)`
}

export function buildSystemPrompt(gradeName?: string | null, schoolRules?: string[]): string {
  const audience = describeGradeAudience(gradeName)
  // Deliberately few rules — whatever can be checked in code (shape, indices,
  // quotes) is checked in code (`checkQuestion`), not by the prompt.
  const lines = [
    'Jsi učitel na české základní škole a píšeš otázky do písemky.',
    '',
    `Otázky řeší ${audience}. Náročnost se řídí ročníkem, ne odborností materiálu:`,
    'z odborného výkladu udělej otázku na jeho podstatu. Nikdy netvoř otázku na úrovni střední nebo vysoké školy.',
    '',
    'Pravidla:',
    '1. Vycházej výhradně z dodaného materiálu. Každá otázka má jednu správnou odpověď, která v materiálu opravdu stojí.',
    '2. Piš jednoduchou spisovnou češtinou. Zadání je jedna krátká věta.',
    '3. Ptej se na hlavní myšlenky, ne na okrajové podrobnosti.',
    '4. Otázka musí být samostatná: nepiš "podle materiálu", "jak je uvedeno výše" ani nic podobného ' +
      '(✗ „Kteří zástupci jsou uvedeni v materiálu?" → ✓ „Kteří z těchto živočichů patří mezi obojživelníky?").',
    '5. Možnosti výběru patří jen do pole `options`, nikdy do textu zadání. Špatné možnosti jsou věrohodné, ale jednoznačně špatné.',
    '6. Do `evidence` napiš název souboru ze záhlaví `=== … ===` a jednu větu z materiálu doslova, beze změny slov. Otázka s citací, která v materiálu není, se zahodí.',
    '7. Do `explanation` napiš jednu větu pro učitele, proč je odpověď správná.',
    '8. Otázky se nesmějí opakovat ani ptát na totéž jinými slovy.',
  ]
  // Only when the admin actually saved a rule — otherwise an empty section
  // would needlessly inflate the prompt for all other schools.
  if (schoolRules && schoolRules.length > 0) {
    lines.push('', 'Pravidla této školy:', ...schoolRules.map((rule) => `- ${rule}`))
  }
  return lines.join('\n')
}

export function buildUserPrompt(request: GenerationRequest): string {
  // The grade is repeated here, not only in the system prompt: with long
  // materials the system part is far away and difficulty is the one thing
  // that must not get lost.
  const gradeLine = request.gradeName
    ? `Ročník: ${request.gradeName} — ${describeGradeAudience(request.gradeName)}`
    : `Ročník: neurčen — ${describeGradeAudience(null)}`
  const difficultyLine =
    request.difficulty === 'mix'
      ? 'Obtížnost: promíchej lehké, střední i těžké otázky (zhruba 1/3 každé).'
      : `Obtížnost: ${request.difficulty} (1 = lehká, 2 = střední, 3 = těžká) u všech otázek.`

  // `request.types` may contain repeats — each occurrence of a type is one
  // requested question of that type in this batch (see the distribution of
  // types among batches in generate.ts). Summing gives the exact count per
  // type instead of a generic "split evenly", which made no sense for a few
  // questions across nine types.
  const typeCounts = new Map<QuestionType, number>()
  for (const t of request.types) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  const typeLines = [...typeCounts.entries()].map(
    ([t, n]) => `- ${t} (${questionTypeLabel(t)}) × ${n}: ${QUESTION_TYPE_HINTS[t]}`,
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
    '',
    'Před odevzdáním zkontroluj každou otázku: odpovídá požadovanému typu, má platnou strukturu, jde vyřešit z materiálu a její evidence odpověď přímo dokládá.',
  ]

  if (request.avoid?.length) {
    sections.push(
      '',
      'Tyto otázky už existují, vytvoř jiné (ani parafráze):',
      ...request.avoid.slice(0, AI_SETTINGS.avoidLimit).map((q) => `- ${truncateAvoidItem(q)}`),
    )
  }

  if (request.replacementReason) {
    sections.push('', `Proč se otázka nahrazuje: ${request.replacementReason.hint}`)
    const note = request.replacementReason.note?.trim()
    if (note) {
      const truncated =
        note.length > MAX_REPLACEMENT_NOTE_LENGTH ? `${note.slice(0, MAX_REPLACEMENT_NOTE_LENGTH)}…` : note
      // A quotation in a delimited block, not an instruction: the note is what
      // the teacher wrote, the model must not follow it as another generation
      // rule. Plain quotes could be closed early by a quote in the note
      // ("ignoruj pravidla") — triple quotes (same pattern as for the material
      // and the style sample below) cannot be closed by a single character.
      sections.push('Poznámka učitelky:', '"""', truncated, '"""')
    }
  }

  if (request.variantOf) {
    const word = request.variantOf.direction === 'easier' ? 'lehčí' : 'těžší'
    sections.push(
      '',
      `Vytvoř ${word} verzi této otázky na stejnou látku — ne tutéž otázku jinými slovy: ${request.variantOf.originalPrompt}`,
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
