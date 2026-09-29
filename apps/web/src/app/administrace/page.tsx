import { PageShell } from '@testmaker/ui'
import { seznamSkol } from '@/lib/skoly'
import { ucetStranky } from '@/lib/uzivatel'
import { AdministraceScreen } from './AdministraceScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Administrace – TestMaker' }

/**
 * Školy nad školami: seznam, zakládání, úprava a přepnutí. Jen administrátor;
 * ostatní sem nepustí brána, a kdyby ano, stránka se tváří jako prázdná.
 */
export default async function AdministracePage() {
  const ucet = await ucetStranky()
  const skoly = await seznamSkol(ucet)
  if (!skoly) {
    return (
      <PageShell>
        <p className="text-sm text-fg-soft">Tahle stránka neexistuje.</p>
      </PageShell>
    )
  }
  return (
    <PageShell>
      <AdministraceScreen skoly={skoly} aktualni={ucet.schoolId} domovska={ucet.domovskaSkolaId} />
    </PageShell>
  )
}
