import { aktualniUzivatel } from '@/lib/uzivatel'
import { ZmenaHeslaForm } from './ZmenaHeslaForm'

export const metadata = { title: 'Změna hesla – TestMaker' }

// Stav relace se čte při každém požadavku; předvykreslená stránka by ho neznala.
export const dynamic = 'force-dynamic'

/**
 * Změna vlastního hesla. Po resetu správcem sem brána pustí a nikam jinam —
 * heslo, které zná ještě někdo další, nemá zůstat v provozu. Jestli jde
 * o takovou vynucenou změnu, ví jen server; podle toho se nabídne cesta zpět.
 */
export default async function ZmenaHeslaPage() {
  const uzivatel = await aktualniUzivatel()
  return <ZmenaHeslaForm vynucena={uzivatel?.mustChangePassword ?? false} />
}
