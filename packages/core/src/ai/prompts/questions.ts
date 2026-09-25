import { QUESTION_TYPE_LABELS, type QuestionType } from '../../schema/question'
import { AI_SETTINGS } from '../settings'

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
  /**
   * Citace (`evidence.quote`) nahrazované otázky. Když je, generuje se
   * z úseku, ve kterém ta citace stojí — náhrada má být ze stejné látky.
   */
  focus?: string
}

export const QUESTION_TYPE_HINTS: Record<QuestionType, string> = {
  open: 'Volná odpověď na 2–6 řádků; v `answer` uveď vzorovou odpověď, ne jen heslo.',
  short_answer: 'Odpověď je jedno slovo nebo krátké sousloví z materiálu. Do `acceptedAnswers` dej běžné varianty.',
  single_choice: 'Čtyři možnosti, právě jedna správná. `correctIndex` je pořadí správné možnosti od nuly.',
  multi_choice: 'Správné jsou 2–3 možnosti z 4–6. Nikdy ne všechny.',
  true_false: '4 krátká tvrzení, zhruba půl pravdivých. Nepravdivé tvrzení vznikne malou změnou pravdivého.',
  fill_blank: 'Souvislý text s ___ na místě vynechaných výrazů. Počet ___ musí přesně odpovídat poli `blanks`.',
  matching: 'Dva sloupce stejné délky (4–6 položek). `pairs` obsahuje dvojice indexů.',
  ordering:
    'Posloupnost, vývoj, cesta látky. `items` vypiš v libovolném pořadí a do `correctOrder` dej indexy do `items` udávající skutečně správné pořadí — odděl si tak "co vypsat" od "v jakém pořadí to patří za sebe". Aplikace položky pro tisk stejně zamíchá.',
  table_fill: 'Tabulka s hlavičkou; buňky k doplnění zapiš jako null a jejich správné hodnoty dej do `answers` po řádcích.',
  label_image: 'Nepoužívej — obrázky se ve fázi 1 negenerují.',
}

function truncateAvoidItem(text: string): string {
  return text.length > AI_SETTINGS.avoidItemMaxLength
    ? `${text.slice(0, AI_SETTINGS.avoidItemMaxLength)}…`
    : text
}

/**
 * Pro koho se otázky píšou. Materiály od učitelky bývají odbornější než to,
 * co má žák umět (vysokoškolská skripta, odborné články), a model bez tohohle
 * vodítka jede po náročnosti textu, ne po ročníku — pak z přírodopisu v šestce
 * vyleze otázka na buněčné dýchání pojmy z vysoké školy.
 *
 * Věk se odvozuje z čísla na začátku názvu ročníku (`8. ročník`), stejně jako
 * pořadí ročníků v knihovně. Bez čísla i bez ročníku zůstává obecný žák
 * základní školy: to je nejhorší odhad, se kterým se nic nepokazí, protože
 * pořád drží model pod úrovní střední školy.
 */
export function describeGradeAudience(gradeName: string | null | undefined): string {
  const match = gradeName ? /^\s*(\d+)/.exec(gradeName) : null
  const grade = match ? Number(match[1]) : null
  if (grade === null || grade < 1 || grade > 9) return 'žák základní školy'
  // První ročník nastupuje v šesti letech, každý další o rok výš.
  return `žák ${grade}. ročníku základní školy (${grade + 5}–${grade + 6} let)`
}

export function buildSystemPrompt(gradeName?: string | null): string {
  const audience = describeGradeAudience(gradeName)
  // Pravidel je schválně málo — co jde zkontrolovat v kódu (tvar, indexy,
  // citace), se kontroluje v kódu (`checkQuestion`), ne promptem.
  return [
    'Jsi učitel na české základní škole a píšeš otázky do písemky.',
    '',
    `Otázky řeší ${audience}. Náročnost se řídí ročníkem, ne odborností materiálu:`,
    'z odborného výkladu udělej otázku na jeho podstatu. Nikdy netvoř otázku na úrovni střední nebo vysoké školy.',
    '',
    'Pravidla:',
    '1. Vycházej výhradně z dodaného materiálu. Každá otázka má jednu správnou odpověď, která v materiálu opravdu stojí.',
    '2. Piš jednoduchou spisovnou češtinou. Zadání je jedna krátká věta.',
    '3. Ptej se na hlavní myšlenky, ne na okrajové podrobnosti.',
    '4. Otázka musí být samostatná: nepiš "podle materiálu", "jak je uvedeno výše" ani nic podobného.',
    '5. Možnosti výběru patří jen do pole `options`, nikdy do textu zadání. Špatné možnosti jsou věrohodné, ale jednoznačně špatné.',
    '6. Do `evidence` napiš název souboru ze záhlaví `=== … ===` a jednu větu z materiálu doslova, beze změny slov. Otázka s citací, která v materiálu není, se zahodí.',
    '7. Do `explanation` napiš jednu větu pro učitele, proč je odpověď správná.',
    '8. Otázky se nesmějí opakovat ani ptát na totéž jinými slovy.',
  ].join('\n')
}

export function buildUserPrompt(request: GenerationRequest): string {
  // Ročník se opakuje i tady, ne jen v systémovém promptu: u dlouhých materiálů
  // je systémová část daleko a náročnost je to jediné, co se nesmí ztratit.
  const gradeLine = request.gradeName
    ? `Ročník: ${request.gradeName} — ${describeGradeAudience(request.gradeName)}`
    : `Ročník: neurčen — ${describeGradeAudience(null)}`
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
    ([t, n]) => `- ${t} (${QUESTION_TYPE_LABELS[t]}) × ${n}: ${QUESTION_TYPE_HINTS[t]}`,
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
