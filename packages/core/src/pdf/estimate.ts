import type { Block } from '../schema/blocks'
import { answerLines, type ResolvedTestItem } from '../schema/test'
import { resolveQuestionStyle, type TemplateConfig } from '../schema/template'
import { buildPuzzle } from '../puzzle/index'
import { puzzleInstructions, type PuzzleContent } from '../schema/puzzle'
import {
  CRYPTOGRAM_NUMBER_WIDTH,
  WORD_LIST_COLUMNS,
  cellSize,
  cryptogramLayout,
  placedEntries,
} from './layout'
import { mm } from './styles'

/** Výška A4 v bodech (PDF pt); 1 pt = 1/72". */
const PAGE_HEIGHT_PT = 842
/** Šířka A4 v bodech. */
const PAGE_WIDTH_PT = 595.28

/**
 * Paušál za obrázkový blok — `QuestionBody.tsx` ho vykresluje v šířce dané
 * procenty sloupce, skutečná výška závisí na poměru stran obrázku, který
 * odhad nezná. 130 pt odpovídá běžnému ilustračnímu obrázku ve středním
 * měřítku (marginTop 6 + marginBottom 4 z `BlockView` plus samotný obrázek).
 */
const IMAGE_BLOCK_HEIGHT = 130

/** Výška jednoho řádku tabulkového bloku — stejný odhad jako `table_fill`. */
const TABLE_BLOCK_ROW_HEIGHT = 20

/** Okraje tabulkového bloku (marginTop/marginBottom kolem `View` v `BlockView`). */
const TABLE_BLOCK_MARGIN = 10

/** Výška jednoho řádku textu v bodech, odvozená z velikosti písma šablony. */
function lineHeight(config: TemplateConfig): number {
  return config.page.fontSize * config.page.lineHeight
}

/** Hrubý odhad počtu řádků, které zabere zadání dané délky. */
function promptLines(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 70))
}

/**
 * Paušální přirážka za přílohový blok otázky (obrázek nebo tabulka) — bez
 * ní by test s přílohami vycházel o celou stranu kratší, než ve skutečnosti
 * je. Přesnost se nečeká, jen řádová blízkost skutečnému PDF.
 */
function blockHeight(block: Block): number {
  if (block.kind === 'image') return IMAGE_BLOCK_HEIGHT
  return block.rows.length * TABLE_BLOCK_ROW_HEIGHT + TABLE_BLOCK_MARGIN
}

/**
 * Odhad výšky hlavičky testu (nadpis, podtitul, řádky s poli) — tiskne se
 * jen jednou, na první straně, proto ji `paginate` přičítá jen tam. Vychází
 * z toho, co vykresluje `Header` v `TestDocument.tsx`; hodnota polí testu
 * (název, popis) do configu nepatří, takže se počítá jen se strukturou.
 */
function estimateHeaderHeight(config: TemplateConfig, heading?: PrintHeading): number {
  if (!config.header.show) return 0
  const line = lineHeight(config)
  // marginBottom celé hlavičky (`View` v `Header`).
  let height = 12
  if (config.header.title.show) {
    // Řádek nadpisu + marginBottom pod ním.
    height += config.header.title.fontSize + 8
  }
  const description = heading?.description?.trim()
  if (description) {
    // Popis testu (u samostatného hlavolamu jeho pokyn) + marginBottom 6.
    height += wrappedLines(description, contentWidth(config), config.page.fontSize) * line + 6
  }
  if (config.header.fields.length > 0) {
    const totalWidthPercent = config.header.fields.reduce((sum, field) => sum + field.widthPercent, 0)
    const rows = Math.max(1, Math.ceil(totalWidthPercent / 100))
    // Řádek pole (linka nebo text) + marginBottom 6 z `Header`.
    height += rows * (line + 6)
  }
  return height
}

/**
 * Nadpis a popis testu, jak je tiskne hlavička. Odhad podle nich pozná,
 * co hlavolam neopakuje (samostatný hlavolam má nadpis i pokyn v hlavičce),
 * a u samostatného hlavolamu započítá do hlavičky i pokyn. Bez nich (náhled
 * ve skladači) se počítá s hlavolamem i s jeho nadpisem.
 */
export interface PrintHeading {
  title: string
  description?: string | null
}

/**
 * Co z hlavičky hlavolamu se tiskne: nadpis a pokyn se vynechají, když totéž
 * už stojí v hlavičce testu. Jedno pravidlo pro `TestDocument` i odhad.
 */
export function puzzleHeadShown(
  puzzle: PuzzleContent,
  config: TemplateConfig,
  heading?: PrintHeading,
): { title: boolean; instructions: boolean } {
  const headerTitle = heading && config.header.show && config.header.title.show ? heading.title.trim() : null
  const headerText = heading && config.header.show ? (heading.description ?? '').trim() : null
  return {
    title: puzzle.title.trim() !== headerTitle,
    instructions: puzzleInstructions(puzzle).trim() !== headerText,
  }
}

/**
 * Bezpečnostní rezerva pro odhad výšky položky. Porovnání s doopravdy
 * vykresleným PDF (viz `render-samples.test.ts`) ukázalo, že hrubý odhad
 * bez rezervy systematicky podhodnocuje skutečnou výšku — u devíti ukázkových
 * otázek v kompaktní šabloně předpověděl jednu stranu, skutečné PDF
 * potřebovalo dvě. Otázka se navíc na stránce nedělí (kromě typu `open`),
 * takže i malé podhodnocení u otázek před ní může celou další otázku
 * vytlačit na novou stranu a odhad selže. Učitelka se podle odhadu rozhoduje,
 * kolik kopií poslat do tiskárny — raději o stranu navíc v náhledu, než aby
 * jí vytiskárna nečekaně vytiskla neúplnou písemku.
 */
const SAFETY_MARGIN = 1.15

/**
 * Odhad výšky vykreslené položky v bodech (PDF pt). Slouží hrubému náhledu v
 * prohlížeči a stránkování — nejde o přesný layout, jen o to, aby se test
 * rozdělil na stránky přibližně stejně jako skutečné PDF (raději s rezervou,
 * viz `SAFETY_MARGIN`).
 */
export function estimateHeight(item: ResolvedTestItem, config: TemplateConfig, heading?: PrintHeading): number {
  if (item.kind === 'page_break') return 0
  const parts = puzzleParts(item, config, heading)
  if (parts) return sum(parts) * PUZZLE_SAFETY_MARGIN
  return rawEstimateHeight(item, config) * SAFETY_MARGIN
}

/**
 * Hlavolam se počítá téměř přesně (rozměry buněk i políček jsou pevné, text
 * se zalamuje podle šířek písmen), proto stačí malá rezerva — velká by
 * zbytečně posílala hlavolam na další stranu a lámala ho tam, kde se vejde.
 */
const PUZZLE_SAFETY_MARGIN = 1.01

/**
 * Do jaké části výšky strany se hlavolam musí podle odhadu vejít, aby se
 * tiskl nerozdělitelně celý. Rezerva kryje nepřesnost odhadu: nerozdělitelný
 * blok vyšší než strana react-pdf slisuje a tisk je k nepotřebě.
 */
const KEEP_TOGETHER_LIMIT = 0.9

/** Využitelná výška strany (bez horního a dolního okraje). */
export function usablePageHeight(config: TemplateConfig): number {
  return PAGE_HEIGHT_PT - mm(config.page.marginTopMm) - mm(config.page.marginBottomMm)
}

/**
 * Tiskne se hlavolam celý nerozdělitelně? Ano, když se podle odhadu vejde na
 * stranu s rezervou — pak se radši celý přesune na další stranu, než aby se
 * seznam slov odtrhl od mřížky. Vyšší hlavolam se láme po řádcích. Rozhoduje
 * o tom `TestDocument` i `paginate`, aby náhled lámal stejně jako PDF.
 */
export function puzzleKeepsTogether(item: ResolvedTestItem, config: TemplateConfig, heading?: PrintHeading): boolean {
  return estimateHeight(item, config, heading) <= usablePageHeight(config) * KEEP_TOGETHER_LIMIT
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0)

/**
 * Průměrná šířka znaku v em — změřeno na písmech Noto Sans/Serif nad českým
 * textem (malá písmena kolem 0,48 em, velká kolem 0,6 em, mezera 0,26 em).
 */
function charWidth(char: string): number {
  if (char === ' ') return 0.26
  return char !== char.toLowerCase() ? 0.6 : 0.5
}

/**
 * Kolik řádků zabere text v dané šířce. React-pdf láme po slovech (dělení
 * slov je vypnuté, viz `fonts.ts`), tak se láme i tady.
 */
export function wrappedLines(text: string, width: number, fontSize: number): number {
  const space = charWidth(' ') * fontSize
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = [...word].reduce((total, char) => total + charWidth(char), 0) * fontSize
    if (used > 0 && used + space + w > width) {
      lines += 1
      used = w
    } else {
      used += (used > 0 ? space : 0) + w
    }
  }
  return lines
}

/** Šířka textové plochy stránky. */
function contentWidth(config: TemplateConfig): number {
  return PAGE_WIDTH_PT - mm(config.page.marginLeftMm) - mm(config.page.marginRightMm)
}

/**
 * Výška hlavolamu po nerozdělitelných kusech, přesně v pořadí, v jakém je
 * tiskne `PuzzleBody`: první kus je hlavička s mřížkou (resp. s políčky
 * tajenky), další jsou jednotlivé řádky seznamů, mezi které se smí vložit
 * zlom stránky. Pro jinou položku než hlavolam vrací `null`.
 */
export function puzzleParts(item: ResolvedTestItem, config: TemplateConfig, heading?: PrintHeading): number[] | null {
  if (item.kind !== 'puzzle' || !item.puzzle) return null
  const puzzle = item.puzzle
  const width = contentWidth(config)
  // React-pdf přepočte řádkování stránky (násobek) na body podle písma
  // stránky a potomkům ho dědí v bodech — řádek nadpisu i drobného textu
  // (9 pt) je proto vysoký stejně jako řádek běžného textu. Změřeno.
  const pageLine = lineHeight(config)
  const small = 9
  const smallLine = pageLine

  const shown = puzzleHeadShown(puzzle, config, heading)
  const head =
    // Bez nadpisu i pokynu odpadá i mezera nad hlavolamem (viz `PuzzleView`).
    (shown.title || shown.instructions ? config.sectionStyle.spacingBefore : 0) +
    (shown.title ? pageLine : 0) +
    (shown.instructions ? wrappedLines(puzzleInstructions(puzzle), width, config.page.fontSize) * pageLine : 0)

  const built = buildPuzzle(puzzle)
  if (built.kind === 'wordsearch') {
    const grid = 6 + built.wordSearch.rows * cellSize(built.wordSearch.cols)
    const showClues = puzzle.kind === 'wordsearch' && puzzle.payload.showClues
    const columnWidth = width / WORD_LIST_COLUMNS - 6
    const entries = placedEntries(puzzle, built)
    const rows: number[] = []
    for (let i = 0; i < entries.length; i += WORD_LIST_COLUMNS) {
      const lines = Math.max(
        ...entries
          .slice(i, i + WORD_LIST_COLUMNS)
          .map((entry) =>
            wrappedLines(`${entry.word.toUpperCase()}${showClues ? ` – ${entry.clue}` : ''}`, columnWidth, small),
          ),
      )
      // marginTop 8 nad seznamem se přičte k prvnímu řádku.
      rows.push(lines * smallLine + 2 + (i === 0 ? 8 : 0))
    }
    return [head + grid, ...rows]
  }

  const result = built.cryptogram
  const { boxSize } = cryptogramLayout(result)
  // Políčka věty se zalamují po slovech (mezi slovy 8 pt).
  let phraseLines = 1
  let used = 0
  for (const word of result.phraseWords) {
    const w = word.length * boxSize + 8
    if (used > 0 && used + w > width) {
      phraseLines += 1
      used = w
    } else used += w
  }
  const phrase = 6 + smallLine + 3 + phraseLines * (boxSize + 2) + 8
  const label = smallLine + 3
  const gridRows = result.rows.map((_, i) => boxSize + 3 + (i === 0 ? label : 0))
  const clueWidth = width - CRYPTOGRAM_NUMBER_WIDTH - 6
  const clues = result.rows.map(
    (row, i) => wrappedLines(row.clue, clueWidth, small) * smallLine + 3 + (i === 0 ? 8 + label : 0),
  )
  return [head + phrase, ...gridRows, ...clues]
}

function rawEstimateHeight(item: ResolvedTestItem, config: TemplateConfig): number {
  const line = lineHeight(config)

  if (item.kind === 'heading') {
    return config.sectionStyle.spacingBefore + config.sectionStyle.fontSize * 1.6
  }

  if (item.kind === 'instruction') {
    return 12 + promptLines(item.text ?? '') * line
  }

  const question = item.question
  if (!question) return 0

  const style = resolveQuestionStyle(config, question.type)
  const base = style.spacingBefore + promptLines(question.payload.prompt) * line

  let body: number
  switch (question.type) {
    case 'open':
    case 'draw':
      body = answerLines(question, item.linesOverride) * style.answerLineHeight
      break
    case 'short_answer':
      body = 20
      break
    case 'single_choice':
    case 'multi_choice': {
      const rows = Math.ceil(question.payload.options.length / style.optionColumns)
      body = rows * (line + 4)
      break
    }
    case 'true_false':
      // hlavičkový řádek + řádek na tvrzení
      body = (question.payload.statements.length + 1) * 18
      break
    case 'fill_blank':
      body = line * 2 + (question.payload.wordBank.length > 0 ? 24 : 0)
      break
    case 'matching':
      body = Math.max(question.payload.left.length, question.payload.right.length) * 19
      break
    case 'ordering':
      body = question.payload.items.length * 19
      break
    case 'table_fill':
      // hlavičkový řádek + datové řádky
      body = (question.payload.rows.length + 1) * 20
      break
    case 'label_image':
      body = 100 + question.payload.labels.length * 17
      break
    default:
      body = 20
  }

  const blocksHeight = question.blocks.reduce((sum, block) => sum + blockHeight(block), 0)

  return base + blocksHeight + body
}

/**
 * Rozdělí položky testu na stránky podle odhadované výšky. Zalomení
 * (`page_break`) vždy začne novou stranu, i kdyby se zbytek vešel.
 *
 * Hlavolam, který se netiskne nerozdělitelně (viz `puzzleKeepsTogether`),
 * se láme po řádcích stejně jako v PDF: patří na stranu, kde začíná, ale jeho
 * zbytek zabírá místo na dalších stranách. Strana, na kterou přeteče jen
 * zbytek hlavolamu, je v seznamu prázdná — i tak se vytiskne, a počet stran
 * proto musí sedět.
 */
export function paginate(
  items: ResolvedTestItem[],
  config: TemplateConfig,
  heading?: PrintHeading,
): ResolvedTestItem[][] {
  const usableHeight = usablePageHeight(config)
  const firstContent = items.findIndex((item) => item.kind !== 'page_break')

  const pages: ResolvedTestItem[][] = []
  let current: ResolvedTestItem[] = []
  // Hlavička se tiskne jen jednou na první straně, proto zabírá místo jen tam.
  let used = estimateHeaderHeight(config, heading)
  // Na stranu přetekl zbytek hlavolamu z předchozí — strana není prázdná.
  let continued = false

  const newPage = () => {
    pages.push(current)
    current = []
    used = 0
    continued = false
  }

  items.forEach((item, index) => {
    if (item.kind === 'page_break') {
      if (current.length > 0 || continued) newPage()
      return
    }

    const parts = puzzleParts(item, config, heading)
    if (parts && (index === firstContent || !puzzleKeepsTogether(item, config, heading))) {
      const scaled = parts.map((part) => part * PUZZLE_SAFETY_MARGIN)
      const [head = 0, ...rows] = scaled
      if ((current.length > 0 || continued) && used + head > usableHeight) newPage()
      current.push(item)
      used += head
      for (const row of rows) {
        if (used + row > usableHeight) {
          newPage()
          continued = true
        }
        used += row
      }
      return
    }

    const height = estimateHeight(item, config, heading)
    if ((current.length > 0 || continued) && used + height > usableHeight) newPage()

    current.push(item)
    used += height
  })

  if (current.length > 0 || continued || pages.length === 0) pages.push(current)

  return pages
}
