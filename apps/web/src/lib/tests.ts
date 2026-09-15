import 'server-only'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  resolveTestItemQuestion,
  serializeQuestionSnapshot,
  templateConfigSchema,
  type RenderableTest,
  type ResolvedTestItem,
  type Template,
  type Test,
} from '@testmaker/core/schema'
import { db, assets, questions, templates, testItems, tests } from '@/db'
import { toQuestion } from './questions'

export async function loadTemplates(): Promise<Template[]> {
  const rows = await db.select().from(templates).orderBy(asc(templates.position), asc(templates.name))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    config: templateConfigSchema.parse(row.config),
    builtIn: row.builtIn,
  }))
}

export async function loadTest(testId: string): Promise<Test | null> {
  const [row] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1)
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    graded: row.graded,
    templateId: row.templateId,
    header: row.header,
    variants: row.variants === 2 ? 2 : 1,
    showKey: row.showKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Snímky otázek pro ukládaný test. Vznikají vždy na serveru z aktuálního
 * stavu banky — kdyby je posílal prohlížeč, dal by se obsah písemky
 * podvrhnout.
 */
export async function buildQuestionSnapshots(
  questionIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(questionIds)]
  if (ids.length === 0) return new Map()

  const rows = await db.select().from(questions).where(inArray(questions.id, ids))
  const snapshots = new Map<string, string>()
  for (const row of rows) {
    try {
      snapshots.set(row.id, serializeQuestionSnapshot(toQuestion(row)))
    } catch {
      // Otázka, která neprojde schématem (typicky starší data), se prostě
      // nezmrazí — test se kvůli tomu uložit nesmí odmítnout a při
      // vykreslení se sáhne po živé otázce.
    }
  }
  return snapshots
}

/**
 * Položky testu i s navázanými otázkami, seřazené podle pořadí. Otázka se
 * bere ze snímku pořízeného při uložení testu; živá otázka z banky se použije
 * jen tam, kde snímek chybí (starší testy) nebo je poškozený.
 */
export async function loadTestItems(testId: string): Promise<ResolvedTestItem[]> {
  const rows = await db
    .select()
    .from(testItems)
    .where(eq(testItems.testId, testId))
    .orderBy(asc(testItems.position))

  const questionIds = rows.map((row) => row.questionId).filter((id): id is string => Boolean(id))
  const questionRows =
    questionIds.length > 0
      ? await db.select().from(questions).where(inArray(questions.id, questionIds))
      : []
  const byId = new Map(questionRows.map((row) => [row.id, toQuestion(row)]))

  return rows.map((row) => {
    const live = row.questionId ? (byId.get(row.questionId) ?? null) : null
    return {
      id: row.id,
      testId: row.testId,
      order: row.position,
      kind: row.kind,
      questionId: row.questionId,
      text: row.text,
      pointsOverride: row.pointsOverride,
      linesOverride: row.linesOverride,
      questionSnapshot: row.questionSnapshot,
      ...resolveTestItemQuestion(row.questionSnapshot, live, row.id),
    }
  })
}

/** Obrázky použité v testu jako data URL — react-pdf je vkládá přímo. */
async function loadAssets(items: ResolvedTestItem[]): Promise<Record<string, string>> {
  const ids = new Set<string>()
  for (const item of items) {
    for (const block of item.question?.blocks ?? []) {
      if (block.kind === 'image') ids.add(block.assetId)
    }
    if (item.question?.type === 'label_image') ids.add(item.question.payload.assetId)
  }
  if (ids.size === 0) return {}

  const rows = await db.select().from(assets).where(inArray(assets.id, [...ids]))
  return Object.fromEntries(
    rows.map((row) => [row.id, `data:${row.mimeType};base64,${Buffer.from(row.data).toString('base64')}`]),
  )
}

/** Vše potřebné pro vykreslení testu do PDF. */
export async function loadRenderableTest(
  testId: string,
  options: { variant: 'A' | 'B'; withKey: boolean },
): Promise<RenderableTest | null> {
  const test = await loadTest(testId)
  if (!test) return null

  const [templateRow] = await db.select().from(templates).where(eq(templates.id, test.templateId)).limit(1)
  if (!templateRow) return null

  const items = await loadTestItems(testId)

  return {
    test,
    template: {
      id: templateRow.id,
      name: templateRow.name,
      description: templateRow.description,
      config: templateConfigSchema.parse(templateRow.config),
      builtIn: templateRow.builtIn,
    },
    items,
    variant: options.variant,
    withKey: options.withKey,
    assets: await loadAssets(items),
  }
}
