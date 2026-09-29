import { PageShell } from '@testmaker/ui'
import { db } from '@/db'
import { spocitej } from '@/lib/backup'
import { roleMuzeSpravovat } from '@/lib/role'
import { ucetStranky } from '@/lib/uzivatel'
import { ZalohaScreen } from './ZalohaScreen'

export const metadata = { title: 'Záloha – TestMaker' }

// Počty se musí shodovat s tím, co je v knihovně právě teď — jinak by po
// obnově stránka ukazovala čísla z doby před ní.
export const dynamic = 'force-dynamic'

export default async function ZalohaPage() {
  // Záloha je celá škola včetně cizích písemek — proto ji vidí jen správce.
  const ucet = await ucetStranky()
  if (!roleMuzeSpravovat(ucet.role)) {
    return (
      <PageShell>
        <p className="text-sm text-fg-soft">
          Zálohu školy stahuje a obnovuje správce. Vlastní písemky si vytiskneš v Testech.
        </p>
      </PageShell>
    )
  }

  const pocty = await spocitej(db, { schoolId: ucet.schoolId })

  return (
    <PageShell>
      <ZalohaScreen pocty={pocty} />
    </PageShell>
  )
}
