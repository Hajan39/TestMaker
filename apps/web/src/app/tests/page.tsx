import { desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Button, Card, EmptyState } from '@testmaker/ui'
import { db, questions, templates, testItems, tests } from '@/db'
import { TestRow } from './TestRow'

export const dynamic = 'force-dynamic'

export default async function TestsPage() {
  const rows = await db
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
    .orderBy(desc(tests.updatedAt))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">Testy</h1>
        <Link href="/tests/new">
          <Button>Nový test</Button>
        </Link>
      </div>

      {rows.length === 0 ? (
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
          <div className="overflow-x-auto">
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
        </Card>
      )}
    </div>
  )
}
