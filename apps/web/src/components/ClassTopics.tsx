import Link from 'next/link'
import { EmptyState, OTAZKY, TEMATA, pocet } from '@testmaker/ui'
import { BulkGenerate } from '@/components/BulkGenerate'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { NewLibraryItem, RenameLibraryItem } from '@/components/LibraryItemDialogs'
import { MoveTopic } from '@/components/MoveTopic'
import { TopicTile } from '@/components/TopicTile'
import type { ClassInfo } from '@/lib/library'

/**
 * Obsah stránky třídy: nadpis (předmět a přejmenovatelný ročník), témata
 * s počty a stavem generování, přidání tématu, hromadné generování pro celou
 * třídu a smazání ročníku. Odkaz „Všechny třídy" jde zpátky na úvod bez
 * přesměrování na naposledy otevřenou třídu.
 */
export function ClassTopics({
  classInfo,
  ai,
}: {
  classInfo: ClassInfo
  ai: { configured: boolean; provider: string; model: string }
}) {
  const questionCount = classInfo.topics.reduce((sum, topic) => sum + topic.questionCount, 0)

  return (
    <div className="space-y-5">
      <Link href="/?vse=1" className="text-sm text-fg-muted hover:text-brand">
        ← Všechny třídy
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-fg-muted">{classInfo.subjectName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <h1 className="ui-page-title">{classInfo.gradeName || 'Bez ročníku'}</h1>
            <RenameLibraryItem kind="grade" id={classInfo.gradeId} name={classInfo.gradeName} iconOnly />
          </div>
          <p className="mt-1 text-sm text-fg-soft">
            {pocet(classInfo.topics.length, TEMATA)} · {pocet(questionCount, OTAZKY)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BulkGenerate
            ai={ai}
            scopes={[{ label: 'Vygenerovat pro celou třídu', gradeId: classInfo.gradeId }]}
          />
          <NewLibraryItem kind="topic" parentId={classInfo.gradeId} label="Přidat téma" />
          <DeleteFromLibrary kind="grade" id={classInfo.gradeId} redirectTo="/" />
        </div>
      </div>

      {classInfo.topics.length === 0 ? (
        <EmptyState
          title="V téhle třídě zatím není žádné téma"
          hint="Přidej téma tlačítkem nahoře, nebo do ní naimportuj materiály."
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {classInfo.topics.map((topic) => (
            <li key={topic.id}>
              <TopicTile
                id={topic.id}
                name={topic.name}
                materialCount={topic.materialCount}
                questionCount={topic.questionCount}
                lowContent={topic.lowContent}
                jobState={topic.jobState}
                actions={<MoveTopic topicId={topic.id} currentGradeName={classInfo.gradeName} />}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
