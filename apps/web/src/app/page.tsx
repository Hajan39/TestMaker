import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MATERIALY,
  OTAZKY,
  TEMATA,
  ThreePane,
  plural,
  pocet,
} from '@testmaker/ui'
import { BulkGenerate } from '@/components/BulkGenerate'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { TopicList } from '@/components/TopicList'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { NewLibraryItem, RenameLibraryItem } from '@/components/LibraryItemDialogs'
import { TopicTile } from '@/components/TopicTile'
import { aiStatus } from '@/lib/ai'
import { loadLibraryTree, type GradeNode, type SubjectNode } from '@/lib/library'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string }>
}) {
  const ucet = await ucetStranky()
  const { grade: gradeId } = await searchParams
  const tree = await loadLibraryTree(ucet)
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

/**
 * Věta o čekající práci. Celé rozhraní počítá jedním směrem — kolik zbývá
 * ke kontrole — a jedním slovem: „ke kontrole“. Skloňování řeší sdílená
 * pomocná funkce z návrhového systému, ne pátá kopie téhož pravidla.
 */
function keKontrole(count: number): string {
  return `${pocet(count, OTAZKY)} ke kontrole`
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
          acc.drafts += topic.draftCount
        }
      }
      return acc
    },
    { topics: 0, materials: 0, questions: 0, approved: 0, drafts: 0 },
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Přehled knihovny</h1>
          <p className="mt-1 text-sm text-fg-soft">
            {pocet(totals.topics, TEMATA)} · {pocet(totals.materials, MATERIALY)} ·{' '}
            {pocet(totals.questions, OTAZKY)} ({totals.approved} schválených)
          </p>
          {/* Kolik otázek čeká na kontrolu, je to první, co učitelka potřebuje
              vědět — proto vlastním řádkem a barvou konceptu, ne v závorce
              mezi ostatními čísly. */}
          {totals.drafts > 0 ? (
            <p className="mt-1 text-sm font-medium text-draft-fg">{keKontrole(totals.drafts)}</p>
          ) : null}
        </div>
        {/* Na úzké obrazovce se akce zalomí pod sebe místo toho, aby vytekly
            z hlavičky — `main` vodorovné rolování skrývá, takže tlačítko za
            okrajem by bylo nedosažitelné. */}
        <div className="flex flex-wrap items-center gap-2">
          <BulkGenerate
            ai={aiStatus()}
            // Rod předmětu se z názvu složky uhodnout nedá („Celý MATEMATIKA“),
            // tak se do názvu tlačítka přídavné jméno vůbec nedává.
            scopes={tree.map((subject) => ({ label: `Předmět ${subject.name}`, subjectId: subject.id }))}
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
              <RenameLibraryItem kind="subject" id={subject.id} name={subject.name} iconOnly />
              <NewLibraryItem kind="grade" parentId={subject.id} iconOnly variant="ghost" />
              <DeleteFromLibrary kind="subject" id={subject.id} iconOnly />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subject.grades.map((gradeNode) => {
              const drafts = gradeNode.topics.reduce((sum, topic) => sum + topic.draftCount, 0)
              return (
                <Link key={gradeNode.id} href={`/?grade=${gradeNode.id}`}>
                  <Card className="p-4 hover:border-brand">
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 text-sm font-medium text-fg">
                        {gradeNode.name || 'Bez ročníku'}
                      </h3>
                      {drafts > 0 ? (
                        <Badge className="shrink-0 bg-draft-bg text-draft-fg">{drafts} ke kontrole</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-fg-muted">{pocet(gradeNode.topics.length, TEMATA)}</p>
                  </Card>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Dlaždice témat zvoleného ročníku s počty a hromadným generováním. */
function GradeOverview({ grade }: { grade: GradeNode }) {
  const questionCount = grade.topics.reduce((sum, topic) => sum + topic.questionCount, 0)
  const draftCount = grade.topics.reduce((sum, topic) => sum + topic.draftCount, 0)
  const topicsWithDrafts = grade.topics.filter((topic) => topic.draftCount > 0).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">{grade.name || 'Bez ročníku'}</h1>
          <p className="mt-1 text-sm text-fg-soft">
            {pocet(grade.topics.length, TEMATA)} · {pocet(questionCount, OTAZKY)}
          </p>
          {draftCount > 0 ? (
            <p className="mt-1 text-sm font-medium text-draft-fg">
              {keKontrole(draftCount)} v {topicsWithDrafts}{' '}
              {plural(topicsWithDrafts, 'tématu', 'tématech', 'tématech')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BulkGenerate
            ai={aiStatus()}
            scopes={[{ label: 'Generovat pro celý ročník', gradeId: grade.id }]}
          />
          <NewLibraryItem kind="topic" parentId={grade.id} iconOnly variant="ghost" />
          <RenameLibraryItem kind="grade" id={grade.id} name={grade.name} iconOnly />
          <DeleteFromLibrary kind="grade" id={grade.id} iconOnly redirectTo="/" />
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {grade.topics.map((topic) => (
          <li key={topic.id}>
            {/* Přejmenování je uvnitř dlaždice u názvu, ne vedle ní. */}
            <TopicTile
              id={topic.id}
              name={topic.name}
              materialCount={topic.materialCount}
              questionCount={topic.questionCount}
              draftCount={topic.draftCount}
              lowContent={topic.lowContent}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
