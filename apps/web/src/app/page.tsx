import Link from 'next/link'
import { Button, Card, EmptyState, ThreePane } from '@testmaker/ui'
import { BulkGenerate } from '@/components/BulkGenerate'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { TopicList } from '@/components/TopicList'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { NewLibraryItem, RenameLibraryItem } from '@/components/LibraryItemDialogs'
import { TopicTile } from '@/components/TopicTile'
import { aiStatus } from '@/lib/ai'
import { loadLibraryTree, type GradeNode, type SubjectNode } from '@/lib/library'

export const dynamic = 'force-dynamic'

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string }>
}) {
  const { grade: gradeId } = await searchParams
  const tree = await loadLibraryTree()
  const grade = tree.flatMap((s) => s.grades).find((g) => g.id === gradeId) ?? null

  if (tree.length === 0) {
    return (
      <EmptyState
        title="Knihovna je zatím prázdná"
        hint="Naimportuj složku s materiály — z každého souboru se vytáhne text a vznikne téma. Nebo si založ prázdný předmět a otázky si napiš sama."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/import">
              <Button>Importovat materiály</Button>
            </Link>
            <NewLibraryItem kind="subject" label="Založit předmět" size="default" />
          </div>
        }
      />
    )
  }

  return (
    <ThreePane
      first={<LibrarySidebar tree={tree} activeGradeId={gradeId} />}
      second={<TopicList grade={grade} />}
    >
      {grade ? <GradeOverview grade={grade} /> : <LibraryOverview tree={tree} />}
    </ThreePane>
  )
}

/** Souhrn celé knihovny a rozcestník na jednotlivé ročníky. */
function LibraryOverview({ tree }: { tree: SubjectNode[] }) {
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Přehled knihovny</h1>
          <p className="mt-1 text-sm text-fg-soft">
            {totals.topics} témat · {totals.materials} materiálů · {totals.questions} otázek (
            {totals.approved} schválených)
          </p>
        </div>
        <div className="flex gap-2">
          <BulkGenerate
            ai={aiStatus()}
            scopes={tree.map((subject) => ({ label: `Celý ${subject.name}`, subjectId: subject.id }))}
          />
          <Link href="/import">
            <Button size="sm" variant="outline">
              Přidat materiály
            </Button>
          </Link>
          <Link href="/tests/new">
            <Button size="sm">Nový test</Button>
          </Link>
        </div>
      </div>

      {tree.map((subject) => (
        <section key={subject.id}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="ui-label">{subject.name}</h2>
            <div className="flex items-center gap-1">
              <RenameLibraryItem kind="subject" id={subject.id} name={subject.name} />
              <NewLibraryItem kind="grade" parentId={subject.id} label="Nový ročník" />
              <DeleteFromLibrary kind="subject" id={subject.id} label="Smazat předmět" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subject.grades.map((gradeNode) => (
              <Link key={gradeNode.id} href={`/?grade=${gradeNode.id}`}>
                <Card className="p-4 hover:border-brand">
                  <h3 className="text-sm font-medium text-fg">{gradeNode.name || 'Bez ročníku'}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{gradeNode.topics.length} témat</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Dlaždice témat zvoleného ročníku s počty a hromadným generováním. */
function GradeOverview({ grade }: { grade: GradeNode }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">{grade.name || 'Bez ročníku'}</h1>
          <p className="mt-1 text-sm text-fg-soft">{grade.topics.length} témat</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BulkGenerate
            ai={aiStatus()}
            scopes={[{ label: 'Generovat pro celý ročník', gradeId: grade.id }]}
          />
          <NewLibraryItem kind="topic" parentId={grade.id} label="Nové téma" />
          <RenameLibraryItem kind="grade" id={grade.id} name={grade.name} label="Přejmenovat ročník" />
          <DeleteFromLibrary kind="grade" id={grade.id} label="Smazat ročník" redirectTo="/" />
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {grade.topics.map((topic) => (
          <li key={topic.id} className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <TopicTile
                id={topic.id}
                name={topic.name}
                materialCount={topic.materialCount}
                questionCount={topic.questionCount}
                approvedCount={topic.approvedCount}
                lowContent={topic.lowContent}
              />
            </div>
            {/* U dlaždice stačí ikona: popisek u každého tématu zvlášť by přebil názvy. */}
            <RenameLibraryItem kind="topic" id={topic.id} name={topic.name} iconOnly />
          </li>
        ))}
      </ul>
    </div>
  )
}
