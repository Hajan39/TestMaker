import type { ResolvedTestItem } from '../schema/test'
import { resolveQuestionStyle, type TemplateConfig } from '../schema/template'
import { mm } from './styles'

/** Výška A4 v bodech (PDF pt); 1 pt = 1/72". */
const PAGE_HEIGHT_PT = 842

/** Výška jednoho řádku textu v bodech, odvozená z velikosti písma šablony. */
function lineHeight(config: TemplateConfig): number {
  return config.page.fontSize * config.page.lineHeight
}

/** Hrubý odhad počtu řádků, které zabere zadání dané délky. */
function promptLines(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 70))
}

/**
 * Odhad výšky vykreslené položky v bodech (PDF pt). Slouží hrubému náhledu v
 * prohlížeči a stránkování — nejde o přesný layout, jen o to, aby se test
 * rozdělil na stránky přibližně stejně jako skutečné PDF.
 */
export function estimateHeight(item: ResolvedTestItem, config: TemplateConfig): number {
  if (item.kind === 'page_break') return 0

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
      body = question.payload.lines * style.answerLineHeight
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

  return base + body
}

/**
 * Rozdělí položky testu na stránky podle odhadované výšky. Zalomení
 * (`page_break`) vždy začne novou stranu, i kdyby se zbytek vešel.
 */
export function paginate(items: ResolvedTestItem[], config: TemplateConfig): ResolvedTestItem[][] {
  const usableHeight = PAGE_HEIGHT_PT - mm(config.page.marginTopMm) - mm(config.page.marginBottomMm)

  const pages: ResolvedTestItem[][] = []
  let current: ResolvedTestItem[] = []
  let used = 0

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
