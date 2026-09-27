import { redirect } from 'next/navigation'

/**
 * Kontrola konceptů přes celou knihovnu se zrušila — schvalování se dělá
 * přímo v tématu. Starý odkaz s `topicId` (v záložkách, v e-mailu) vede
 * rovnou na tohle téma; bez něj skončí na úvodu místo chybové stránky
 * (existenci tématu ověří až jeho vlastní stránka).
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ topicId?: string }>
}) {
  const { topicId } = await searchParams
  redirect(topicId ? `/topics/${topicId}` : '/')
}
