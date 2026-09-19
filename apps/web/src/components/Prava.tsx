'use client'

import { createContext, useContext } from 'react'

/**
 * Smí přihlášená osoba měnit obsah? Role `nahled` si čte a tiskne, ale nic
 * nemění — a musí to poznat z rozhraní, ne až z odmítnuté akce. Brána
 * zapisující požadavky zastaví tak jako tak; tohle je ta srozumitelnější
 * polovina té dvojice.
 */
const MuzeMenitContext = createContext(true)

export function PravaProvider({
  muzeMenit,
  children,
}: {
  muzeMenit: boolean
  children: React.ReactNode
}) {
  return <MuzeMenitContext.Provider value={muzeMenit}>{children}</MuzeMenitContext.Provider>
}

export function useMuzeMenit(): boolean {
  return useContext(MuzeMenitContext)
}
