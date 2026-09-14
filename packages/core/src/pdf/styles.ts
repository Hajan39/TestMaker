import type { TemplateConfig } from '../schema/template.js'

/** Milimetry na body (1 pt = 1/72", 1 mm = 2.8346 pt). */
export const mm = (value: number): number => value * 2.834645669

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const

export function questionLabel(index: number, numbering: TemplateConfig['numbering']): string {
  switch (numbering) {
    case 'none':
      return ''
    case 'decimal':
      return `${index + 1}`
    case 'paren':
      return `${index + 1})`
    case 'decimal-dot':
    default:
      return `${index + 1}.`
  }
}

export function pagePadding(config: TemplateConfig) {
  return {
    paddingTop: mm(config.page.marginTopMm),
    paddingBottom: mm(config.page.marginBottomMm),
    paddingLeft: mm(config.page.marginLeftMm),
    paddingRight: mm(config.page.marginRightMm),
  }
}
