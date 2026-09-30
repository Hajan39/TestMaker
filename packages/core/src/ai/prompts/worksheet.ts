import { AI_QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionType } from '../../schema/question'
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from '../../schema/test'
import { AI_SETTINGS } from '../settings'
import { describeGradeAudience, QUESTION_TYPE_HINTS } from './questions'

/**
 * Zadání pracovního listu, jak ho skládá web z tématu nebo volného zadání.
 * Na rozdíl od otázek do banky smí list vycházet i z obecných znalostí;
 * model proto musí u každé položky přiznat, jestli vychází z dodaného textu.
 */
export interface WorksheetRequest {
  /** Název tématu z knihovny, nebo název listu z volného zadání. */
  title: string
  subjectName: string | null
  gradeName: string | null
  /** Text materiálů tématu (bez duplicit), soubory oddělené `=== název ===`; může být prázdný. */
  materials: string
  /** Vlastní text, který učitelka vložila do zadání; může být prázdný. */
  ownText: string
  /** Pokyn učitelky („víc tabulek, jeden fun fact, na 20 minut“); může být prázdný. */
  instructions: string
}

/** Druh kusu, který se přegenerovává; u úlohy i její typ. */
export type WorksheetTarget =
  | { kind: 'heading' | 'instruction' | 'text' | 'fun_fact' | 'table' }
  | { kind: 'question'; questionType: QuestionType }

const S = AI_SETTINGS.worksheet

const TARGET_LABELS: Record<Exclude<WorksheetTarget['kind'], 'question'>, string> = {
  heading: 'nadpis části (`kind: "heading"`)',
  instruction: 'pokyn k vypracování (`kind: "instruction"`)',
  text: 'krátký text (`kind: "text"`, `variant: "text"`)',
  fun_fact: 'fun fact – zajímavost (`kind: "text"`, `variant: "fun_fact"`)',
  table: 'tabulku k doplnění (`kind: "table"`)',
}

export function buildWorksheetSystemPrompt(gradeName: string | null): string {
  const types = AI_QUESTION_TYPES.map((type) => `- \`${type}\` (${QUESTION_TYPE_LABELS[type]}): ${QUESTION_TYPE_HINTS[type]}`)
  return [
    'Jsi zkušený učitel na české základní škole a chystáš pracovní list na procvičování v hodině nebo doma.',
    'Nic se na něm neznámkuje: má být pestrý, srozumitelný a má žáka bavit.',
    '',
    `List vyplňuje ${describeGradeAudience(gradeName)}. Jazyk i obtížnost volíš podle ročníku.`,
    '',
    'Položky listu (pole `items`, v pořadí, v jakém se vytisknou):',
    '- `heading` – krátký nadpis části listu.',
    '- `instruction` – pokyn k vypracování (jedna věta).',
    `- \`text\` s \`variant: "text"\` – krátký výkladový text bez odstavců, nejvýš ${S.textMax} znaků.`,
    `- \`text\` s \`variant: "fun_fact"\` – zajímavost k tématu (vytiskne se v rámečku „Věděli jste?“), nejvýš ${S.textMax} znaků.`,
    `- \`table\` – tabulka k doplnění: \`header\` jsou názvy sloupců (1 až ${TABLE_MAX_COLUMNS}), \`rows\` řádky (1 až ${TABLE_MAX_ROWS}).`,
    '  Každý řádek má přesně tolik buněk, kolik je sloupců. Buňka `blank: true` zůstane na listu prázdná',
    '  a žák ji doplní; do její `value` napiš správnou odpověď do klíče. Aspoň jedna buňka musí být prázdná.',
    '  Nepovinný `caption` je popisek nad tabulkou.',
    '- `question` – úloha; pole `question` má týž tvar jako otázka do písemky. Použij jen tyto typy:',
    ...types,
    '',
    'Pravidla, která platí bez výjimky:',
    '1. U každé položky vyplň `fromMaterials`: `true` jen tehdy, když obsah vychází z dodaného textu (materiály',
    '   nebo text učitelky). Když přidáváš obecné znalosti mimo dodaný text, napiš `false` — učitelka takové',
    '   položky zkontroluje. U nadpisů a pokynů na tom nezáleží.',
    '2. Fakta piš jen ta, kterými si jsi jistý. Nevymýšlej čísla, jména ani data.',
    '3. Úlohy musí jít vyřešit z textu na listu nebo ze znalostí, které žák toho ročníku má.',
    '4. Žádná položka se neodkazuje na obrázky, strany ani „text výše v materiálu“.',
    `5. List má ${S.minItems + 2} až ${S.maxItems} položek včetně nadpisů a pokynů; střídej druhy položek.`,
    '6. `title` je krátký název listu.',
  ].join('\n')
}

function sourceSections(request: WorksheetRequest, materials: string): string[] {
  const sections = [
    `Předmět: ${request.subjectName ?? 'neurčen'}`,
    `Ročník: ${request.gradeName ?? 'neurčen'} (vyplňuje ${describeGradeAudience(request.gradeName)})`,
    `Téma listu: ${request.title}`,
  ]
  if (request.instructions.trim()) {
    sections.push('', 'Přání učitelky k listu:', '"""', request.instructions.trim(), '"""')
  }
  const ownText = request.ownText.trim()
  if (ownText) sections.push('', 'Text, který učitelka dodala (vycházej z něj přednostně):', '"""', ownText, '"""')
  if (materials.trim()) sections.push('', 'Materiály k tématu:', '"""', materials.trim(), '"""')
  if (!ownText && !materials.trim()) {
    sections.push(
      '',
      'K tématu nemáš žádný text. Pracuj jen z názvu a ročníku a u všech položek uveď `fromMaterials: false`.',
    )
  }
  return sections
}

export function buildWorksheetPrompt(request: WorksheetRequest, materials: string): string {
  return [...sourceSections(request, materials), '', 'Připrav celý pracovní list.'].join('\n')
}

export function buildWorksheetItemPrompt(
  request: WorksheetRequest,
  materials: string,
  target: WorksheetTarget,
  existing: string[],
): string {
  const wanted =
    target.kind === 'question'
      ? `úlohu (\`kind: "question"\`) typu \`${target.questionType}\` (${QUESTION_TYPE_LABELS[target.questionType]})`
      : TARGET_LABELS[target.kind]
  const sections = [...sourceSections(request, materials), '', `Napiš jednu novou položku listu: ${wanted}.`]
  sections.push('Vrať ji v poli `item`. Pravidla ze systémového pokynu platí i tady.')
  if (existing.length > 0) {
    sections.push('', 'Tohle už na listu je — neopakuj to, napiš něco jiného:', ...existing.map((line) => `- ${line}`))
  }
  return sections.join('\n')
}
