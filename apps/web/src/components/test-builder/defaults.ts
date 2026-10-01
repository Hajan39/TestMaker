import type { TestHeaderConfig } from '@testmaker/core/schema'

/**
 * Empty header of a new test — it used to be an inline literal in two places
 * (`TestBuilder`, picking questions from a topic) that risked drifting apart.
 */
export function emptyHeader(): TestHeaderConfig {
  return { school: '', subject: '', className: '', teacher: '', date: '', note: '' }
}

/**
 * Default template of a new test — the first in the order `loadTemplates`
 * returns (`position`, then name). An empty template list returns nothing a
 * test could be saved against by mistake.
 */
export function defaultTemplateId(templates: { id: string }[]): string {
  return templates[0]?.id ?? ''
}
