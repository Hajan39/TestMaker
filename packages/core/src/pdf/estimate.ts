import type { Block } from '../schema/blocks'
import { answerLines, type ResolvedTestItem } from '../schema/test'
import { resolveQuestionStyle, type TemplateConfig } from '../schema/template'
import { buildPuzzle } from '../puzzle/index'
import { cellSize } from './PuzzleBody'
import { mm } from './styles'

/** Výška A4 v bodech (PDF pt); 1 pt = 1/72". */
const PAGE_HEIGHT_PT = 842

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
function estimateHeaderHeight(config: TemplateConfig): number {
  if (!config.header.show) return 0
  const line = lineHeight(config)
  // marginBottom celé hlavičky (`View` v `Header`).
  let height = 12
  if (config.header.title.show) {
    // Řádek nadpisu + marginBottom pod ním.
    height += config.header.title.fontSize + 8
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
export function estimateHeight(item: ResolvedTestItem, config: TemplateConfig): number {
  if (item.kind === 'page_break') return 0
  return rawEstimateHeight(item, config) * SAFETY_MARGIN
}

function rawEstimateHeight(item: ResolvedTestItem, config: TemplateConfig): number {
  const line = lineHeight(config)

  if (item.kind === 'heading') {
    return config.sectionStyle.spacingBefore + config.sectionStyle.fontSize * 1.6
  }

  if (item.kind === 'instruction') {
    return 12 + promptLines(item.text ?? '') * line
  }

  if (item.kind === 'puzzle' && item.puzzle) {
    // Nadpis, pokyn a pod tím mřížka nebo řádky tajenky. Hlavolam se na
    // stránce nedělí (`wrap={false}`), takže odhad rozhoduje o tom, jestli
    // celý spadne na další stranu.
    const head = config.sectionStyle.spacingBefore + config.sectionStyle.fontSize * 1.6 + line
    const built = buildPuzzle(item.puzzle)
    if (built.kind === 'wordsearch') {
      const grid = built.wordSearch.rows * cellSize(built.wordSearch.cols)
      const list = Math.ceil(item.puzzle.entries.length / 3) * 11
      return head + grid + list + 14
    }
    // Řádek tajenky (políčka 14 pt + mezera) a pod tím řádek s tajenkou.
    return head + built.cryptogram.rows.length * 17 + 26
  }

  const question = item.question
  if (!question) return 0

  const style = resolveQuestionStyle(config, question.type)
  const base = style.spacingBefore + promptLines(question.payload.prompt) * line

  let body: number
  switch (question.type) {
    case 'open':
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
 */
export function paginate(items: ResolvedTestItem[], config: TemplateConfig): ResolvedTestItem[][] {
  const usableHeight = PAGE_HEIGHT_PT - mm(config.page.marginTopMm) - mm(config.page.marginBottomMm)

  const pages: ResolvedTestItem[][] = []
  let current: ResolvedTestItem[] = []
  // Hlavička se tiskne jen jednou na první straně, proto zabírá místo jen tam.
  let used = estimateHeaderHeight(config)

  for (const item of items) {
    if (item.kind === 'page_break') {
      if (current.length > 0) {
        pages.push(current)
        current = []
        used = 0
      }
      continue
    }

    const height = estimateHeight(item, config)
    if (current.length > 0 && used + height > usableHeight) {
      pages.push(current)
      current = []
      used = 0
    }

    current.push(item)
    used += height
  }

  if (current.length > 0 || pages.length === 0) pages.push(current)

  return pages
}
