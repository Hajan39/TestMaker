import { aiStatus } from '@/lib/ai'
import { loadLibraryTree } from '@/lib/library'
import { countQuestions } from '@/lib/questions'
import { ReviewScreen, type ReviewScope } from './ReviewScreen'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Kontrola konceptů – TestMaker' }

/**
 * Kontrola konceptů přes celou knihovnu.
 *
 * Po hromadném generování jich bývají stovky napříč ročníky a procházet je
 * uvnitř každého tématu zvlášť je práce na celý večer. Tahle obrazovka je
 * jedno místo, kde se dají odbavit — volitelně zúžené na téma, ročník nebo
 * předmět.
 *
 * Samotné otázky se sem neposílají: fronta si je dotahuje po stránkách
 * (viz `GET /api/questions`), protože jich může být přes tisíc.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ topicId?: string; gradeId?: string; subjectId?: string }>
}) {
  const ucet = await ucetStranky()
  const scope = await searchParams
  const [tree, pending] = await Promise.all([
    loadLibraryTree(ucet),
    countQuestions(ucet, { statuses: ['draft'] }),
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

  const initialScope: ReviewScope = {
    subjectId: scope.subjectId ?? '',
    gradeId: scope.gradeId ?? '',
    topicId: scope.topicId ?? '',
  }

  return (
    <ReviewScreen
      subjects={subjects}
      grades={grades}
      topics={topics}
      initialScope={initialScope}
      pending={pending}
      aiConfigured={aiStatus().configured}
    />
  )
}
