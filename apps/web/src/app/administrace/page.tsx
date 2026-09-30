import { PageShell } from '@testmaker/ui'
import { obdobiZ, prehledPouzitiAi } from '@/lib/aiUsage'
import { seznamSkol } from '@/lib/skoly'
import { ucetStranky } from '@/lib/uzivatel'
import { AdministraceScreen } from './AdministraceScreen'
import { PouzitiAi } from './PouzitiAi'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Administrace – TestMaker' }

/**
 * Školy nad školami: seznam, zakládání, úprava a přepnutí. Jen administrátor;
 * ostatní sem nepustí brána, a kdyby ano, stránka se tváří jako prázdná.
 */
export default async function AdministracePage({
  searchParams,
}: {
  searchParams: Promise<{ dni?: string }>
}) {
  const ucet = await ucetStranky()
  const skoly = await seznamSkol(ucet)
  const prehled = await prehledPouzitiAi(ucet, obdobiZ((await searchParams).dni))
  if (!skoly || !prehled) {
    return (
      <PageShell>
        <p className="text-sm text-fg-soft">Tahle stránka neexistuje.</p>
      </PageShell>
    )
  }
  return (
    <PageShell>
      <AdministraceScreen
        skoly={skoly}
        aktualni={ucet.schoolId}
        domovska={ucet.domovskaSkolaId}
        pouzitiAi={<PouzitiAi prehled={prehled} />}
      />
    </PageShell>
  )
}
