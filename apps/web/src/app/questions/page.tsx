import Link from 'next/link'
import {
  QUESTION_STATUSES,
  QUESTION_TYPES,
  type QuestionStatus,
  type QuestionType,
} from '@testmaker/core/schema'
import { Button, EmptyState, PageShell } from '@testmaker/ui'
import { loadLibraryTree } from '@/lib/library'
import { QUESTION_PAGE_SIZE, countQuestions, loadQuestionPage } from '@/lib/questions'
import { QuestionsTable, type BankFilters } from './QuestionsTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Banka otázek – TestMaker' }

/** Kolik otázek se vejde do jedné stránky banky. Zbytek se dotahuje na vyžádání. */
export const BANK_PAGE_SIZE = QUESTION_PAGE_SIZE

/** Hodnota z adresy jen tehdy, když ji schéma otázek zná — jinak se filtr ignoruje. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | '' {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : ''
}

/**
 * Banka otázek přes celou knihovnu.
 *
 * Filtry jsou v adrese, aby se dal odkaz poslat („koukni na ty zamítnuté
 * v osmičce") a aby se dalo vrátit zpátky tam, kde učitelka skončila.
 * Otázky se načítají po stránkách přímo z databáze — dřív se do prohlížeče
 * poslala celá banka i s obsahem otázek a hledalo se až tam.
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    subjectId?: string
    gradeId?: string
    topicId?: string
    type?: string
    status?: string
    q?: string
  }>
}) {
  const params = await searchParams

  const filters: BankFilters = {
    subjectId: params.subjectId ?? '',
    gradeId: params.gradeId ?? '',
    topicId: params.topicId ?? '',
    type: oneOf<QuestionType>(params.type, QUESTION_TYPES),
    status: oneOf<QuestionStatus>(params.status, QUESTION_STATUSES),
    search: params.q ?? '',
  }

  // Bez zúžení na stav se ukazuje všechno — i koncepty a zamítnuté. Přehled
  // banky je právě od toho, aby bylo vidět, co kde leží; do skladače testu se
  // oproti tomu berou jen schválené.
  const query = {
    statuses: filters.status ? [filters.status] : undefined,
    types: filters.type ? [filters.type] : undefined,
    subjectId: filters.subjectId || undefined,
    gradeId: filters.gradeId || undefined,
    topicId: filters.topicId || undefined,
    search: filters.search || undefined,
  }

  const [tree, page, total] = await Promise.all([
    loadLibraryTree(),
    loadQuestionPage(query, { limit: BANK_PAGE_SIZE }),
    countQuestions(query),
  ])

  const subjects = tree.map((subject) => ({ id: subject.id, name: subject.name }))
  const grades = tree.flatMap((subject) =>
    subject.grades.map((grade) => ({
      id: grade.id,
      name: grade.name || 'Bez ročníku',
      subjectId: subject.id,
    })),
  )
  const topics = tree.flatMap((subject) =>
    subject.grades.flatMap((grade) =>
      grade.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        gradeId: grade.id,
        subjectId: subject.id,
        label: [subject.name, grade.name, topic.name].filter(Boolean).join(' · '),
      })),
    ),
  )

  // Prázdná banka a „filtru nic neodpovídá" jsou dvě různé situace a učitelka
  // potřebuje vědět, která to je. Počítá se jen tehdy, když filtr nic nenašel.
  const libraryEmpty = total === 0 ? (await countQuestions()) === 0 : false

  if (libraryEmpty) {
    return (
      <EmptyState
        title="Banka otázek je prázdná"
        hint="Otevři téma a vygeneruj otázky z materiálu, nebo si napiš vlastní."
        action={
          <Link href="/">
            <Button>Přejít na přehled</Button>
          </Link>
        }
      />
    )
  }

  return (
    <PageShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Počet je jen jednou, a to nad tabulkou („20 z 57“) — tam se totiž
              mění s filtrem i s dotahováním dalších otázek. V nadpisu by proti
              němu stálo druhé číslo téhož. */}
          <h1 className="ui-page-title">Banka otázek</h1>
          <Link href="/tests/new">
            <Button>Poskládat test</Button>
          </Link>
        </div>

        <QuestionsTable
          subjects={subjects}
          grades={grades}
          topics={topics}
          filters={filters}
          items={page.items}
          nextCursor={page.nextCursor}
          total={total}
          pageSize={BANK_PAGE_SIZE}
        />
      </div>
    </PageShell>
  )
}
