import { redirect } from 'next/navigation'

/**
 * Library-wide draft review was removed — approval happens right in the
 * topic. An old link with `topicId` (bookmarks, e-mail) goes straight to that
 * topic; without it, it lands on home instead of an error page (the topic's
 * own page checks it exists).
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ topicId?: string }>
}) {
  const { topicId } = await searchParams
  redirect(topicId ? `/topics/${topicId}` : '/')
}
