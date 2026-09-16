'use client'

import { usePathname } from 'next/navigation'
import { MainNav } from '@/components/MainNav'
import { LogoutButton } from './LogoutButton'

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
const BEZ_NAVIGACE = ['/login']

export function AppChrome({
  children,
  prihlasovaniZapnuto,
}: {
  children: React.ReactNode
  /** Bez přihlašování (lokální běh) nemá odhlašovací tlačítko co dělat. */
  prihlasovaniZapnuto: boolean
}) {
  const pathname = usePathname()
  // Na přihlašovací stránce by tlačítko „Odhlásit se“ bylo k smíchu.
  if (BEZ_NAVIGACE.includes(pathname)) return <>{children}</>
  return (
    <MainNav>
      {children}
      {prihlasovaniZapnuto ? <LogoutButton /> : null}
    </MainNav>
  )
}
