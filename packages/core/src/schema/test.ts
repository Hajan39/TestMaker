import { z } from 'zod'
import type { Question } from './question'
import type { Template } from './template'

/** Položka testu — struktura testu není omezená na pouhý seznam otázek. */
export const TEST_ITEM_KINDS = ['question', 'heading', 'instruction', 'page_break'] as const
export type TestItemKind = (typeof TEST_ITEM_KINDS)[number]

export const testHeaderConfigSchema = z.object({
  school: z.string().default(''),
  subject: z.string().default(''),
  className: z.string().default(''),
  teacher: z.string().default(''),
  /** Datum jako text; prázdné = linka k doplnění. */
  date: z.string().default(''),
  note: z.string().default(''),
})

export type TestHeaderConfig = z.infer<typeof testHeaderConfigSchema>

export interface TestItem {
  id: string
  testId: string
  order: number
  kind: TestItemKind
  /** Vyplněno u `kind === 'question'`. */
  questionId: string | null
  /** Text nadpisu nebo instrukce. */
  text: string | null
  /** Přepis bodů pro tuto otázku v tomto testu. */
  pointsOverride: number | null
}

export interface Test {
  id: string
  title: string
  description: string | null
  /** Test na známky — bez toho se nevykreslují body ani políčko na známku. */
  graded: boolean
  templateId: string
  header: TestHeaderConfig
  /** 1 = jen varianta A, 2 = A i B. */
  variants: 1 | 2
  showKey: boolean
  createdAt: string
  updatedAt: string
}

/** Test připravený k vykreslení: položky mají navázané otázky. */
export interface ResolvedTestItem extends TestItem {
  /** Vyplněno u `kind === 'question'`. */
  question?: Question | null
}

export interface RenderableTest {
  test: Test
  template: Template
  items: ResolvedTestItem[]
  /** 'A' | 'B' — varianta B má přeházené pořadí. */
  variant: 'A' | 'B'
  /** Vykreslit klíč místo/za testem. */
  withKey: boolean
  /** Data obrázků použitých v testu (assetId → data URL). */
  assets: Record<string, string>
}

/** Celkový počet bodů testu. */
export function totalPoints(items: ResolvedTestItem[]): number {
  return items.reduce((sum, item) => {
    if (item.kind !== 'question' || !item.question) return sum
    return sum + (item.pointsOverride ?? item.question.points)
  }, 0)
}
