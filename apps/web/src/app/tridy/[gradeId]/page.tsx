import { notFound } from 'next/navigation'
import { ClassTopics } from '@/components/ClassTopics'
import { RememberClass } from '@/components/RememberClass'
import { aiStatus } from '@/lib/ai'
import { loadClassTopics } from '@/lib/library'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

/**
 * Stránka jedné třídy (ročníku): jeho témata s počty a stavem generování.
 * Cizí nebo smazaný ročník se tváří jako neexistující — 404, ne odmítnutí,
 * ze kterého by šlo poznat, že vůbec je.
 */
export default async function ClassPage({ params }: { params: Promise<{ gradeId: string }> }) {
  const ucet = await ucetStranky()
  const { gradeId } = await params

  const classInfo = await loadClassTopics(ucet, gradeId)
  if (!classInfo) notFound()

  return (
    <>
      <RememberClass gradeId={classInfo.gradeId} userId={ucet.userId} />
      <ClassTopics classInfo={classInfo} ai={aiStatus()} />
    </>
  )
}
