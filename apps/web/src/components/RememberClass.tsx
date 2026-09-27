'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Základ klíče v `localStorage` pro naposledy otevřenou třídu — bez uživatele. */
const LAST_CLASS_KEY_BASE = 'testmaker-last-class'

/**
 * Klíč je na uživatele — bez toho by si sdílené zařízení (nebo lokální běh
 * bez přihlašování, kde `userId` je vždy stejné výchozí id) pletlo, kdo
 * naposledy kterou třídu otevřel, a přesměrovávalo by jednu učitelku na
 * třídu druhé.
 */
function lastClassKey(userId: string): string {
  return `${LAST_CLASS_KEY_BASE}:${userId}`
}

type RememberClassProps =
  | {
      /** Stránka třídy nebo tématu: jen si zapamatuje, kde učitelka byla. */
      gradeId: string
      knownGradeIds?: undefined
      escape?: undefined
      userId: string
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
      userId: string
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
  const key = lastClassKey(props.userId)
  const router = useRouter()

  useEffect(() => {
    if (!gradeId) return
    try {
      localStorage.setItem(key, gradeId)
    } catch {
      // Soukromé okno bez úložiště — prostě se nic nezapamatuje.
    }
  }, [gradeId, key])

  useEffect(() => {
    if (!knownGradeIds || escape) return
    try {
      const stored = localStorage.getItem(key)
      if (!stored) return
      if (knownGradeIds.includes(stored)) {
        router.replace(`/tridy/${stored}`)
      } else {
        // Třída mezitím zmizela (smazaný ročník) — zapamatovaný odkaz by
        // vedl na 404, tak se radši rovnou zapomene.
        localStorage.removeItem(key)
      }
    } catch {
      // Soukromé okno bez úložiště — nic se nenajde, dlaždice zůstanou.
    }
  }, [knownGradeIds, escape, router, key])

  return null
}
