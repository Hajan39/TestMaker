'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Klíč v `localStorage` pro naposledy otevřenou třídu. */
export const LAST_CLASS_KEY = 'testmaker-last-class'

type RememberClassProps =
  | {
      /** Stránka třídy nebo tématu: jen si zapamatuje, kde učitelka byla. */
      gradeId: string
      knownGradeIds?: undefined
      escape?: undefined
    }
  | {
      /**
       * Úvod: přesměruje na zapamatovanou třídu, pokud ještě v knihovně je.
       * `knownGradeIds` jsou id všech tříd, které úvod právě vykreslil —
       * podle nich pozná, jestli zapamatovaná třída mezitím nezmizela.
       */
      gradeId?: undefined
      knownGradeIds: string[]
      /** Odkaz „Všechny třídy“ (`/?vse=1`) přesměrování na tenhle jeden načtení potlačí. */
      escape: boolean
    }

/**
 * Zapamatuje si naposledy otevřenou třídu (stránka třídy i tématu), a na
 * úvodu do ní rovnou přesměruje. Když je zapamatovaná třída mezitím smazaná,
 * úvod si to tiše zapomene a ukáže dlaždice, ne chybu.
 */
export function RememberClass(props: RememberClassProps) {
  const gradeId = 'gradeId' in props ? props.gradeId : undefined
  const knownGradeIds = 'knownGradeIds' in props ? props.knownGradeIds : undefined
  const escape = 'escape' in props ? props.escape : undefined
  const router = useRouter()

  useEffect(() => {
    if (!gradeId) return
    try {
      localStorage.setItem(LAST_CLASS_KEY, gradeId)
    } catch {
      // Soukromé okno bez úložiště — prostě se nic nezapamatuje.
    }
  }, [gradeId])

  useEffect(() => {
    if (!knownGradeIds || escape) return
    try {
      const stored = localStorage.getItem(LAST_CLASS_KEY)
      if (!stored) return
      if (knownGradeIds.includes(stored)) {
        router.replace(`/tridy/${stored}`)
      } else {
        // Třída mezitím zmizela (smazaný ročník) — zapamatovaný odkaz by
        // vedl na 404, tak se radši rovnou zapomene.
        localStorage.removeItem(LAST_CLASS_KEY)
      }
    } catch {
      // Soukromé okno bez úložiště — nic se nenajde, dlaždice zůstanou.
    }
  }, [knownGradeIds, escape, router])

  return null
}
