'use client'

import { createContext, useContext } from 'react'

/**
 * Smí přihlášená osoba měnit obsah? Role `nahled` si čte a tiskne, ale nic
 * nemění — a musí to poznat z rozhraní, ne až z odmítnuté akce. Brána
 * zapisující požadavky zastaví tak jako tak; tohle je ta srozumitelnější
 * polovina té dvojice.
 */
const MuzeMenitContext = createContext(true)
// Kdo smí do správy (účty, zálohy, mazání v knihovně) — jen `spravce`. Stejný
// důvod jako u `MuzeMenitContext`: tlačítko musí zmizet, ne se nabídnout
// a pak tiše selhat na bráně.
const MuzeSpravovatContext = createContext(true)

export function PravaProvider({
  muzeMenit,
  muzeSpravovat,
  children,
}: {
  muzeMenit: boolean
  muzeSpravovat: boolean
  children: React.ReactNode
}) {
  return (
    <MuzeMenitContext.Provider value={muzeMenit}>
      <MuzeSpravovatContext.Provider value={muzeSpravovat}>{children}</MuzeSpravovatContext.Provider>
    </MuzeMenitContext.Provider>
  )
}

export function useMuzeMenit(): boolean {
  return useContext(MuzeMenitContext)
}

export function useMuzeSpravovat(): boolean {
  return useContext(MuzeSpravovatContext)
}
