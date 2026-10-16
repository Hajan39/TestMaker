import { questionTypeLabel, type QuestionType } from '../../schema/question'
import { AI_SETTINGS } from '../settings'
import { describeGradeAudience } from './questions'

/** Types whose answers can be completed — everything the editor offers except image labelling. */
export type CompletableType = Exclude<QuestionType, 'label_image'>

/**
 * A question as the teacher has it in the editor so far: the payload is
 * unvalidated and may be half-filled (empty options, no answer yet).
 */
export interface QuestionDraft {
  type: CompletableType
  payload: Record<string, unknown>
  explanation?: string
  points?: number
  difficulty?: 1 | 2 | 3
}

export interface AnswerCompletionRequest {
  draft: QuestionDraft
  topicName: string | null
  subjectName: string | null
  gradeName: string | null
  /** Text of the topic's materials, files separated by `=== name ===`; may be empty. */
  materials: string
  /**
   * Step two, after the teacher confirmed: the model may use general
   * knowledge. Step one keeps strictly to the materials.
   */
  allowGeneralKnowledge: boolean
}

const blanksIn = (text: unknown) => (typeof text === 'string' ? (text.match(/___/g) ?? []).length : 0)
const nullCells = (rows: unknown) =>
  Array.isArray(rows) ? rows.flat().filter((cell) => cell === null || cell === '').length : 0

/** What the model returns for the type — the merge in code takes only what is still empty. */
function typeTask(draft: QuestionDraft): string {
  const p = draft.payload
  const options = AI_SETTINGS.answerCompletion.choiceOptions
  switch (draft.type) {
    case 'open':
      return 'Vrať `answer`: vzorovou odpověď k opravování (celé věty, ne jen heslo).'
    case 'draw':
      return 'Vrať `answer`: co má obrázek obsahovat a jak ho popsat — pro učitele k opravování.'
    case 'short_answer':
      return [
        'Vrať `answer`: krátkou správnou odpověď (slovo nebo pár slov)',
        'a `acceptedAnswers`: další odpovědi, které se mají také uznat — synonyma, jiný pravopis, zkratky,',
        'značky a vzorce (např. k „oxid uhličitý“ patří „CO₂“ a „CO2“). Nejvýš 10, neopakuj v nich `answer`;',
        'když žádné nejsou, vrať prázdný seznam.',
      ].join('\n')
    case 'single_choice':
    case 'multi_choice':
      return [
        'Vrať `options`: všechny možnosti — nejdřív ty, které učitelka už napsala, doslova a ve stejném pořadí,',
        `potom doplň další, aby jich bylo celkem aspoň ${options}. U každé vyplň \`correct\`.`,
        draft.type === 'single_choice'
          ? 'Správná je právě jedna; ostatní jsou věrohodné, ale jednoznačně špatné.'
          : 'Správná je jedna nebo více; špatné jsou věrohodné, ale jednoznačně špatné. Možnosti se neopakují.',
      ].join('\n')
    case 'true_false':
      return [
        'Vrať `statements`: když učitelka tvrzení napsala, zopakuj je doslova ve stejném pořadí a u každého',
        'urči `isTrue`. Když žádné nenapsala, napiš 4 krátká tvrzení k zadání, část pravdivých a část nepravdivých.',
      ].join('\n')
    case 'fill_blank':
      return `Vrať \`blanks\`: správný výraz pro každé místo ___ v textu, v pořadí výskytu. Míst je ${blanksIn(p.text)}.`
    case 'matching':
      return [
        'Vrať `right`: ke každé položce levého sloupce, v jejím pořadí, odpovídající položku pravého sloupce.',
        'Když učitelka pravý sloupec vyplnila, vybírej doslova z něj.',
      ].join('\n')
    case 'ordering':
      return 'Vrať `correctOrder`: indexy položek (od 0) ve správném pořadí. Položky samotné neměň.'
    case 'table_fill':
      return [
        'Vrať `tableAnswers`: správné hodnoty prázdných buněk (null) po řádcích, v každém zleva doprava.',
        `Prázdných buněk je ${nullCells(p.rows)}.`,
      ].join('\n')
  }
}

export function buildCompletionSystemPrompt(gradeName: string | null): string {
  return [
    'Jsi zkušený učitel na české základní škole. Kolegyně napsala vlastní otázku do písemky',
    'a potřebuje k ní doplnit odpovědi do klíče.',
    '',
    `Otázku řeší ${describeGradeAudience(gradeName)}.`,
    '',
    'Pravidla, která platí bez výjimky:',
    '1. Zadání ani nic, co učitelka už vyplnila, neměníš. Doplňuješ jen to, co chybí.',
    '2. Piš jednoduchou spisovnou češtinou.',
    '3. Fakta piš jen ta, kterými si jsi jistý. Nevymýšlej čísla, jména ani data.',
    '4. `foundInMaterials` je `true` jen tehdy, když se odpověď dá doložit dodanými materiály.',
    '5. Do `reason` napiš jednu krátkou větu česky: kde v materiálech odpověď je, nebo proč tam není.',
  ].join('\n')
}

export function buildCompletionPrompt(request: AnswerCompletionRequest, materials: string): string {
  const { draft } = request
  const sections = [
    `Předmět: ${request.subjectName ?? 'neurčen'}`,
    `Ročník: ${request.gradeName ?? 'neurčen'}`,
    `Téma: ${request.topicName ?? 'neurčeno'}`,
    '',
    `Typ otázky: \`${draft.type}\` (${questionTypeLabel(draft.type)})`,
    'Otázka, jak ji učitelka zatím napsala (prázdné hodnoty jsou nevyplněné):',
    '"""',
    JSON.stringify(draft.payload, null, 2),
    '"""',
    '',
    typeTask(draft),
  ]
  if (!draft.explanation?.trim()) {
    sections.push('Vrať i `explanation`: jednu větu pro učitele, proč je odpověď správná.')
  }
  if (materials.trim()) sections.push('', 'Materiály k tématu:', '"""', materials.trim(), '"""')
  if (request.allowGeneralKnowledge) {
    sections.push(
      '',
      'V materiálech tématu odpověď není a učitelka souhlasila s obecnými znalostmi: odpověz z toho,',
      'co o tématu spolehlivě víš. `foundInMaterials` vyplň podle pravdy.',
    )
  } else {
    sections.push(
      '',
      'Vycházej výhradně z dodaných materiálů. Když v nich odpověď není, napiš `foundInMaterials: false`,',
      'do `reason` proč a ostatní pole nevyplňuj — nic si nedomýšlej.',
    )
  }
  return sections.join('\n')
}
