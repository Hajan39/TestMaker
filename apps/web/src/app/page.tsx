import Link from 'next/link'
import { Badge, Button, Card, EmptyState } from '@testmaker/ui'
import { BulkGenerate, type BulkScope } from '@/components/BulkGenerate'
import { aiStatus } from '@/lib/ai'
import { loadLibraryTree } from '@/lib/library'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const tree = await loadLibraryTree()
  const totals = tree.reduce(
    (acc, subject) => {
      for (const grade of subject.grades) {
        for (const topic of grade.topics) {
          acc.topics += 1
          acc.materials += topic.materialCount
          acc.questions += topic.questionCount
          acc.approved += topic.approvedCount
        }
      }
      return acc
    },
    { topics: 0, materials: 0, questions: 0, approved: 0 },
  )

  if (tree.length === 0) {
    return (
      <EmptyState
        title="Knihovna je zatím prázdná"
        hint="Naimportuj složku s materiály. Z každého souboru se vytáhne text a vznikne téma."
        action={
          <Link href="/import">
            <Button>Importovat materiály</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Přehled knihovny</h1>
          <p className="mt-1 text-sm text-fg-soft">
            {totals.topics} témat · {totals.materials} materiálů · {totals.questions} otázek (
            {totals.approved} schválených)
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/import">
            <Button size="sm" variant="outline">
              Přidat materiály
            </Button>
          </Link>
          <Link href="/tests/new">
            <Button size="sm">
              Nový test
            </Button>
          </Link>
        </div>
      </div>

      <BulkGenerate
        ai={aiStatus()}
        scopes={[
          ...tree.map((subject): BulkScope => ({ label: `Celý ${subject.name}`, subjectId: subject.id })),
          ...tree.flatMap((subject) =>
            subject.grades
              .filter((grade) => grade.name)
              .map((grade): BulkScope => ({
                label: `${subject.name} · ${grade.name}`,
                gradeId: grade.id,
              })),
          ),
        ]}
      />

      <div className="space-y-5">
        {tree.map((subject) => (
          <section key={subject.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
              {subject.name}
            </h2>
            <div className="space-y-3">
              {subject.grades.map((grade) => (
                <Card key={grade.id} className="p-4">
                  <h3 className="mb-2 text-sm font-medium text-fg-soft">
                    {grade.name || 'Bez ročníku'}
                  </h3>
                  <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {grade.topics.map((topic) => (
                      <li key={topic.id}>
                        <Link
                          href={`/topics/${topic.id}`}
                          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
                        >
                          <span className="truncate text-fg-soft">{topic.name}</span>
                          <span className="ml-auto flex shrink-0 gap-1">
                            {topic.questionCount > 0 ? (
                              <Badge>{topic.questionCount} ot.</Badge>
                            ) : (
                              <Badge variant="secondary">bez otázek</Badge>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
