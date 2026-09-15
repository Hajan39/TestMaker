import type { Question, ResolvedTestItem, TestHeaderConfig } from '@testmaker/core/schema'

/** Položka rozpracovaného testu; `key` je stabilní jen v paměti prohlížeče. */
export interface DraftItem {
  key: string
  /** Id už uložené položky; u nově přidaných `null`. */
  id: string | null
  kind: ResolvedTestItem['kind']
  questionId: string | null
  text: string | null
  pointsOverride: number | null
  /** Přepis počtu linek na odpověď; prázdné = podle otázky. */
  linesOverride: number | null
  question: Question | null
  /** Živá otázka se od zmrazené v testu liší. */
  questionEdited?: boolean
  /** Otázka už v bance není; test drží jen její snímek. */
  questionMissing?: boolean
}

export interface BankFilters {
  search: string
  subject: string
  grade: string
  type: string
  onlyApproved: boolean
}

/** Nastavení testu upravovaná v postranním panelu (Sheet). */
export interface TestSettingsValue {
  title: string
  description: string
  graded: boolean
  templateId: string
  header: TestHeaderConfig
  variants: 1 | 2
  showKey: boolean
}

/** `key` je stabilní jen v paměti prohlížeče, proto stačí čítač na modul. */
let keyCounter = 0
export const nextDraftKey = (): string => `item-${(keyCounter += 1)}`

/** Body s desetinou čárkou podle českého úzu, celá čísla bez zbytečné nuly. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}
