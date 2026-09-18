import { PageShell } from '@testmaker/ui'
import { db } from '@/db'
import { spocitej } from '@/lib/backup'
import { ZalohaScreen } from './ZalohaScreen'

export const metadata = { title: 'Záloha – TestMaker' }

// Počty se musí shodovat s tím, co je v knihovně právě teď — jinak by po
// obnově stránka ukazovala čísla z doby před ní.
export const dynamic = 'force-dynamic'

export default async function ZalohaPage() {
  const pocty = await spocitej(db)

  return (
    <PageShell>
      <ZalohaScreen pocty={pocty} />
    </PageShell>
  )
}
