import { desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Badge, Button, Card, EmptyState } from '@testmaker/ui'
import { db, templates, testItems, tests } from '@/db'

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
    })
    .from(tests)
    .innerJoin(templates, eq(templates.id, tests.templateId))
    .orderBy(desc(tests.updatedAt))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-900">Testy</h1>
        <Link href="/tests/new">
          <Button variant="primary">Nový test</Button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Zatím žádný test"
          hint="Vyber otázky z banky, poskládej test a stáhni ho jako PDF."
          action={
            <Link href="/tests/new">
              <Button variant="primary">Vytvořit test</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <Link href={`/tests/${row.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                  {row.title}
                </Link>
                <span className="text-sm text-ink-500">
                  {row.questionCount} otázek · {row.templateName}
                </span>
                {row.graded ? <Badge tone="brand">na známky</Badge> : <Badge>bez známek</Badge>}
                {row.variants === 2 ? <Badge>varianty A/B</Badge> : null}
                <div className="ml-auto flex gap-2">
                  <a href={`/api/tests/${row.id}/pdf?variant=A`} target="_blank" rel="noreferrer">
                    <Button size="sm">PDF</Button>
                  </a>
                  <Link href={`/tests/${row.id}`}>
                    <Button size="sm" variant="secondary">
                      Upravit
                    </Button>
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
