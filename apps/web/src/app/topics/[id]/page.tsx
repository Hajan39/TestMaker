import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { InlineName } from '@/components/InlineName'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { MATERIALY, OTAZKY, StatRow, plural } from '@testmaker/ui'
import { TopicGroup } from '@/components/TopicGroup'
import { db, grades, materials, subjects, topics } from '@/db'
import { aiStatus } from '@/lib/ai'
import { countQuestions, loadQuestions } from '@/lib/questions'
import { loadTestUsageForQuestions } from '@/lib/tests'
import { TopicWorkspace } from './TopicWorkspace'
import { skola, ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const ucet = await ucetStranky()
  const { id } = await params

  const [topic] = await db
    .select({
      id: topics.id,
      name: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
      usableCharCount: topics.usableCharCount,
      lowContent: topics.lowContent,
    })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(skola(ucet, topics), eq(topics.id, id)))
    .limit(1)

  if (!topic) notFound()

  // Počty se berou dotazem, ne délkou seznamu: seznam je useknutý limitem
  // a u tématu s tisícem otázek by čísla nahoře lhala.
  const [materialRows, questionList, usableQuestionCount] = await Promise.all([
    db
      .select({
        id: materials.id,
        fileName: materials.fileName,
        charCount: materials.charCount,
        pageCount: materials.pageCount,
        needsOcr: materials.needsOcr,
        duplicateOfId: materials.duplicateOfId,
        duplicateScore: materials.duplicateScore,
      })
      .from(materials)
      .where(and(skola(ucet, materials), eq(materials.topicId, id)))
      .orderBy(asc(materials.fileName)),
    // Zamítnuté se do seznamu vůbec nenačítají — karta by je stejně
    // nezobrazovala a učitelka by je nemohla ani upravit, ani vrátit zpět.
    loadQuestions(ucet, { topicIds: [id], statuses: ['draft', 'approved'] }),
    // Jediný počet nahoře i pro dogenerování — zamítnuté (smazané) se do něj
    // nepočítají, jinak by smazání karty číslo nesnížilo.
    countQuestions(ucet, { topicId: id, statuses: ['draft', 'approved'] }),
  ])
  // Do generování jde jen text materiálů, které nejsou duplicitní kopií jiného.
  const usable = materialRows.filter((material) => !material.duplicateOfId)
  const usableCount = usable.length
  const totalChars = usable.reduce((sum, material) => sum + material.charCount, 0)

  // Štítek „V testu: …" a filtr „Jen nepoužité v testu" na kartě otázky —
  // jen za testy, na které tahle učitelka vidí (`viditelnyTest`).
  const usage = await loadTestUsageForQuestions(
    ucet,
    questionList.items.map((question) => question.id),
  )

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-fg-muted">
          <Link href="/" className="hover:text-brand">
            {topic.subjectName}
          </Link>
          {topic.gradeName ? ` · ${topic.gradeName}` : ''}
        </p>
        {/* Název a akce k němu na jednom řádku; čísla o téma níž, na jediném
            místě — dřív se počty materiálů a otázek opakovaly v každé kartě. */}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <InlineName
            kind="topic"
            id={topic.id}
            name={topic.name}
            as="h1"
            className="ui-page-title"
            label="Přejmenovat téma"
          />
          <DeleteFromLibrary kind="topic" id={topic.id} iconOnly redirectTo="/" />
        </div>
      </div>

      <StatRow
        items={[
          { value: usableCount, label: plural(usableCount, ...MATERIALY) },
          { value: totalChars.toLocaleString('cs'), label: 'znaků k dispozici' },
          { value: usableQuestionCount, label: plural(usableQuestionCount, ...OTAZKY) },
        ]}
      />

      <TopicWorkspace
        topicId={topic.id}
        materials={materialRows.filter((material) => !material.duplicateOfId)}
        questions={questionList.items}
        usage={usage}
        listTruncated={questionList.truncated}
        listLimit={questionList.limit}
        usableCount={usableQuestionCount}
        lowContent={topic.lowContent}
        ai={aiStatus()}
        // `key` kvůli varování Reactu: prvek vzniklý na serveru a předaný
        // klientské komponentě jako prop se přenáší jako položka seznamu.
        group={<TopicGroup key="materialy" topicId={topic.id} topicName={topic.name} materials={materialRows} />}
      />
    </div>
  )
}
