import { redirect } from 'next/navigation'

/**
 * Banka otázek přes celou knihovnu se zrušila — otázky (i smazané, přes
 * přepínač „Smazané") se hledají přímo v tématu. Starý odkaz ať skončí na
 * úvodu místo chybové stránky.
 */
export default function QuestionsPage() {
  redirect('/')
}
