import { redirect } from 'next/navigation'

/**
 * Banka otázek přes celou knihovnu se zrušila — otázky (i smazané, přes
 * přepínač „Smazané") se hledají přímo v tématu. Starý odkaz s `topicId`
 * (uložený v záložce nebo v odkazu odjinud) vede rovnou na tohle téma;
 * bez něj, nebo když téma mezitím zmizelo, skončí na úvodu místo chybové
 * stránky (existenci ověří až stránka tématu sama).
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ topicId?: string }>
}) {
  const { topicId } = await searchParams
  redirect(topicId ? `/topics/${topicId}` : '/')
}
