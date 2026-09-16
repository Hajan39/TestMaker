import { and, asc, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Button, Card, EmptyState, PageShell } from '@testmaker/ui'
import { db, questions, templates, testItems, tests } from '@/db'
import { testConditions } from '@/lib/tests'
import { TestRow } from './TestRow'
import { TestsFilters } from './TestsFilters'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Testy – TestMaker' }

/** Kolik testů se ukáže naráz, než se řekne o další. */
const PAGE_SIZE = 25

export default async function TestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; templateId?: string; limit?: string }>
}) {
  const params = await searchParams
  const search = params.q ?? ''
  const templateId = params.templateId ?? ''
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 500)

  const conditions = testConditions({ search, templateId: templateId || undefined })
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
      .where(where)
      .orderBy(desc(tests.updatedAt))
      .limit(limit),
    db
      .select({ value: sql<number>`count(*)` })
      .from(tests)
      .innerJoin(templates, eq(templates.id, tests.templateId))
      .where(where),
    db.select({ id: templates.id, name: templates.name }).from(templates).orderBy(asc(templates.name)),
  ])

  const total = Number(totalRow?.value ?? 0)
  const filtered = Boolean(search.trim()) || Boolean(templateId)

  /** Odkaz na tutéž stránku s vyšším limitem — další testy dotáhne server. */
  const moreParams = new URLSearchParams()
  if (search.trim()) moreParams.set('q', search.trim())
  if (templateId) moreParams.set('templateId', templateId)
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
            <TestsFilters search={search} templateId={templateId} templates={templateRows} />

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
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-fg-muted">
                      <th className="py-2 pr-4 font-medium">Název</th>
                      <th className="py-2 pr-4 font-medium">Otázky</th>
                      <th className="py-2 pr-4 font-medium">Body</th>
                      <th className="py-2 pr-4 font-medium">Šablona</th>
                      <th className="py-2 pr-4 font-medium">Změněno</th>
                      <th className="py-2 pr-0 font-medium text-right">Akce</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {rows.map((row) => (
                      <TestRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
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
