import { redirect } from 'next/navigation'

/**
 * The library-wide question bank was removed — questions (deleted ones too,
 * via the "Smazané" toggle) are searched right in the topic. An old link with
 * `topicId` (a bookmark or a link from elsewhere) goes straight to that topic;
 * without it, or if the topic is gone, it lands on home instead of an error
 * page (the topic page itself checks it exists).
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ topicId?: string }>
}) {
  const { topicId } = await searchParams
  redirect(topicId ? `/topics/${topicId}` : '/')
}
