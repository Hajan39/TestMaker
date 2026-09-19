'use client'

import { usePathname } from 'next/navigation'
import { MainNav } from '@/components/MainNav'
import { PravaProvider } from '@/components/Prava'
import type { Role } from '@/lib/role'

/**
 * Stránky pro nepřihlášenou uživatelku (skupina tras `(auth)`). Navigaci
 * aplikace kolem nich nekreslíme: kdo není přihlášený, stejně nikam
 * neproklikne.
 *
 * Rozhoduje se podle cesty, ne podle skupiny tras: rozvržení skupiny je vždy
 * *uvnitř* kořenového, takže samo navigaci z kořene odebrat nedokáže. Druhá
 * možnost — přesunout i všechny ostatní trasy do skupiny `(app)` s vlastním
 * rozvržením — by znamenala hýbat soubory, na kterých se právě pracuje jinde.
 */
const BEZ_NAVIGACE = ['/login', '/zmena-hesla']

export function AppChrome({
  children,
  ucet,
}: {
  children: React.ReactNode
  /** Přihlášená osoba; bez přihlašování (lokální běh) `null`. */
  ucet: { jmeno: string; email: string; role: Role } | null
}) {
  const pathname = usePathname()
  // Bez přihlašování (lokální běh) se pracuje pod správcem, tedy naplno.
  const muzeMenit = ucet === null || ucet.role !== 'nahled'
  // Na přihlašovací stránce ani při vynucené změně hesla nemá lišta co dělat.
  if (BEZ_NAVIGACE.includes(pathname)) return <>{children}</>
  return (
    <PravaProvider muzeMenit={muzeMenit}>
      <MainNav ucet={ucet}>{children}</MainNav>
    </PravaProvider>
  )
}
