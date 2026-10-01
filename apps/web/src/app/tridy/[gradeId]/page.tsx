import { notFound } from 'next/navigation'
import { ClassTopics } from '@/components/ClassTopics'
import { RememberClass } from '@/components/RememberClass'
import { aiStatus } from '@/lib/ai'
import { loadClassTopics } from '@/lib/library'
import { pageAccount } from '@/lib/user'

export const dynamic = 'force-dynamic'

/**
 * The page of one class (grade): its topics with counts and generation state.
 * A foreign or deleted grade looks non-existent — 404, not a refusal that
 * would reveal it exists at all.
 */
export default async function ClassPage({ params }: { params: Promise<{ gradeId: string }> }) {
  const account = await pageAccount()
  const { gradeId } = await params

  const classInfo = await loadClassTopics(account, gradeId)
  if (!classInfo) notFound()

  return (
    <>
      <RememberClass gradeId={classInfo.gradeId} userId={account.userId} />
      <ClassTopics classInfo={classInfo} ai={aiStatus()} />
    </>
  )
}
