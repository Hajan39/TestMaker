import { redirect } from 'next/navigation'

/**
 * Kontrola konceptů přes celou knihovnu se zrušila — schvalování se dělá
 * přímo v tématu. Starý odkaz (v záložkách, v e-mailu) ať skončí na úvodu
 * místo chybové stránky.
 */
export default function ReviewPage() {
  redirect('/')
}
