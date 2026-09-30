import { and, asc, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import type { TestKind } from '@testmaker/core/schema'
import { Button, Card, EmptyState, PageShell } from '@testmaker/ui'
import { db, grades, questions, subjects, templates, testItems, tests, topics } from '@/db'
import { loadTestGradeOptions, testConditions } from '@/lib/tests'
import { skola, ucetStranky } from '@/lib/uzivatel'
import { TestsTable } from './TestsTable'
import { TestsFilters } from './TestsFilters'
import { overviewPath } from './paths'

/** Kolik položek se ukáže naráz, než se řekne o další. */
const PAGE_SIZE = 25

export interface OverviewParams {
  q?: string
  templateId?: string
  trida?: string
  limit?: string
}

/** Texty, kterými se přehled písemek a přehled listů liší. */
const TEXTS: Record<TestKind, { title: string; add: string; emptyTitle: string; emptyHint: string; create: string }> = {
  pisemka: {
    title: 'Testy',
    add: 'Nový test',
    emptyTitle: 'Zatím žádný test',
    emptyHint: 'Vyber otázky z banky, poskládej test a stáhni ho jako PDF.',
    create: 'Vytvořit test',
  },
  pracovni_list: {
    title: 'Pracovní listy',
    add: 'Nový pracovní list',
    emptyTitle: 'Zatím žádný pracovní list',
    emptyHint: 'Nech model připravit list k tématu nebo podle vlastního zadání a pak ho uprav jako písemku.',
    create: 'Vytvořit pracovní list',
  },
}

/**
 * Přehled písemek, nebo pracovních listů — vlastní i nasdílené ve škole,
 * s hledáním a filtrem podle třídy. Oba přehledy jsou tentýž seznam, jen
 * s jiným druhem (`tests.kind`).
 */
export async function TestsOverview({ kind, params }: { kind: TestKind; params: OverviewParams }) {
  const text = TEXTS[kind]
  const basePath = overviewPath(kind)
  const search = params.q ?? ''
  const templateId = params.templateId ?? ''
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 500)

  const ucet = await ucetStranky()
  const gradeOptions = await loadTestGradeOptions(ucet, kind)
  // Cizí nebo už neplatná třída z odkazu se má chovat jako „Všechny třídy",
  // ne jako filtr, na který nic nesedí.
  const trida = params.trida && gradeOptions.some((grade) => grade.id === params.trida) ? params.trida : ''

  const conditions = testConditions(ucet, {
    search,
    templateId: templateId || undefined,
    gradeId: trida || undefined,
    kind,
  })
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [totalRow], templateRows] = await Promise.all([
    db
      .select({
        id: tests.id,
        kind: tests.kind,
        title: tests.title,
        graded: tests.graded,
        variants: tests.variants,
        updatedAt: tests.updatedAt,
        templateName: templates.name,
        // Prázdné u testu bez třídy — `left join` na `grades`/`subjects` dá
        // v tom případě samé `null`.
        gradeLabel: sql<string | null>`
          case when ${grades.id} is not null then ${subjects.name} || ' · ' || ${grades.name} else null end
        `,
        // Téma listu; smazané téma se vyprázdní a list se ukáže jako volné zadání.
        topicName: topics.name,
        questionCount: sql<number>`(
          select count(*) from ${testItems}
          where ${testItems.testId} = ${tests.id} and ${testItems.kind} = 'question'
        )`,
        itemCount: sql<number>`(
          select count(*) from ${testItems}
          where ${testItems.testId} = ${tests.id} and ${testItems.kind} != 'page_break'
        )`,
        points: sql<number>`(
          select coalesce(sum(coalesce(${testItems.pointsOverride}, ${questions.points})), 0)
          from ${testItems}
          left join ${questions} on ${questions.id} = ${testItems.questionId}
          where ${testItems.testId} = ${tests.id} and ${testItems.kind} = 'question'
        )`,
      })
      .from(tests)
      .innerJoin(templates, eq(templates.id, tests.templateId))
      .leftJoin(grades, eq(grades.id, tests.gradeId))
      .leftJoin(subjects, eq(subjects.id, grades.subjectId))
      .leftJoin(topics, eq(topics.id, tests.topicId))
      .where(where)
      .orderBy(desc(tests.updatedAt))
      .limit(limit),
    db
      .select({ value: sql<number>`count(*)` })
      .from(tests)
      .innerJoin(templates, eq(templates.id, tests.templateId))
      .where(where),
    db
      .select({ id: templates.id, name: templates.name })
      .from(templates)
      .where(skola(ucet, templates))
      .orderBy(asc(templates.name)),
  ])

  const total = Number(totalRow?.value ?? 0)
  const filtered = Boolean(search.trim()) || Boolean(templateId) || Boolean(trida)

  /** Odkaz na tutéž stránku s vyšším limitem — další položky dotáhne server. */
  const moreParams = new URLSearchParams()
  if (search.trim()) moreParams.set('q', search.trim())
  if (templateId) moreParams.set('templateId', templateId)
  if (trida) moreParams.set('trida', trida)
  moreParams.set('limit', String(limit + PAGE_SIZE))

  return (
    <PageShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="ui-page-title">
            {text.title} ({total})
          </h1>
          <Link href={`${basePath}/new`}>
            <Button>{text.add}</Button>
          </Link>
        </div>

        {total === 0 && !filtered ? (
          <EmptyState
            title={text.emptyTitle}
            hint={text.emptyHint}
            action={
              <Link href={`${basePath}/new`}>
                <Button>{text.create}</Button>
              </Link>
            }
          />
        ) : (
          <Card className="overflow-hidden p-4">
            <TestsFilters
              basePath={basePath}
              search={search}
              templateId={templateId}
              templates={templateRows}
              gradeId={trida}
              grades={gradeOptions}
            />

            {rows.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="Filtru nic neodpovídá"
                  hint="Zkus jiné slovo v názvu, jinou šablonu nebo třídu."
                  action={
                    <Link href={basePath}>
                      <Button variant="outline">Zrušit filtry</Button>
                    </Link>
                  }
                />
              </div>
            ) : (
              <TestsTable kind={kind} rows={rows} />
            )}

            {total > rows.length ? (
              <div className="mt-3 flex justify-center">
                <Link href={`${basePath}?${moreParams.toString()}`} scroll={false}>
                  <Button variant="outline">Načíst další ({total - rows.length})</Button>
                </Link>
              </div>
            ) : null}
          </Card>
        )}
      </div>
    </PageShell>
  )
}
