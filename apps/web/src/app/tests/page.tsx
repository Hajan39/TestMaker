import { and, asc, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Button, Card, EmptyState, PageShell } from '@testmaker/ui'
import { db, grades, questions, subjects, templates, testItems, tests } from '@/db'
import { loadTestGradeOptions, testConditions } from '@/lib/tests'
import { TestsTable } from './TestsTable'
import { TestsFilters } from './TestsFilters'
import { skola, ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Testy – TestMaker' }

/** Kolik testů se ukáže naráz, než se řekne o další. */
const PAGE_SIZE = 25

export default async function TestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; templateId?: string; trida?: string; limit?: string }>
}) {
  const params = await searchParams
  const search = params.q ?? ''
  const templateId = params.templateId ?? ''
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 500)

  const ucet = await ucetStranky()
  const gradeOptions = await loadTestGradeOptions(ucet)
  // Cizí nebo už neplatná třída z odkazu se má chovat jako „Všechny třídy",
  // ne jako filtr, na který nic nesedí.
  const trida = params.trida && gradeOptions.some((grade) => grade.id === params.trida) ? params.trida : ''

  const conditions = testConditions(ucet, {
    search,
    templateId: templateId || undefined,
    gradeId: trida || undefined,
  })
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [totalRow], templateRows] = await Promise.all([
    db
      .select({
        id: tests.id,
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
        questionCount: sql<number>`(
          select count(*) from ${testItems}
          where ${testItems.testId} = ${tests.id} and ${testItems.kind} = 'question'
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

  /** Odkaz na tutéž stránku s vyšším limitem — další testy dotáhne server. */
  const moreParams = new URLSearchParams()
  if (search.trim()) moreParams.set('q', search.trim())
  if (templateId) moreParams.set('templateId', templateId)
  if (trida) moreParams.set('trida', trida)
  moreParams.set('limit', String(limit + PAGE_SIZE))

  return (
    <PageShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="ui-page-title">Testy ({total})</h1>
          <Link href="/tests/new">
            <Button>Nový test</Button>
          </Link>
        </div>

        {total === 0 && !filtered ? (
          <EmptyState
            title="Zatím žádný test"
            hint="Vyber otázky z banky, poskládej test a stáhni ho jako PDF."
            action={
              <Link href="/tests/new">
                <Button>Vytvořit test</Button>
              </Link>
            }
          />
        ) : (
          <Card className="overflow-hidden p-4">
            <TestsFilters
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
                  hint="Zkus jiné slovo v názvu nebo jinou šablonu."
                  action={
                    <Link href="/tests">
                      <Button variant="outline">Zrušit filtry</Button>
                    </Link>
                  }
                />
              </div>
            ) : (
              <TestsTable rows={rows} />
            )}

            {total > rows.length ? (
              <div className="mt-3 flex justify-center">
                <Link href={`/tests?${moreParams.toString()}`} scroll={false}>
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
