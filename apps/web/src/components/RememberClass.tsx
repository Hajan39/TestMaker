'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Base of the `localStorage` key for the last opened class — without the user. */
const LAST_CLASS_KEY_BASE = 'testmaker-last-class'

/**
 * The key is per user — otherwise a shared device (or a local run without
 * sign-in, where `userId` is always the same default id) would mix up who
 * opened which class last and redirect one teacher to another's class.
 */
function lastClassKey(userId: string): string {
  return `${LAST_CLASS_KEY_BASE}:${userId}`
}

type RememberClassProps =
  | {
      /** Class or topic page: just remembers where the teacher was. */
      gradeId: string
      knownGradeIds?: undefined
      escape?: undefined
      userId: string
    }
  | {
      /**
       * Home: redirects to the remembered class if it's still in the library.
       * `knownGradeIds` are the ids of all classes home just rendered —
       * they tell whether the remembered class has disappeared meanwhile.
       */
      gradeId?: undefined
      knownGradeIds: string[]
      /** The "Všechny třídy" link (`/?vse=1`) suppresses the redirect for this one load. */
      escape: boolean
      userId: string
    }

/**
 * Remembers the last opened class (class page and topic page) and redirects
 * to it from home. If the remembered class has been deleted meanwhile, home
 * silently forgets it and shows the tiles, not an error.
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
      // Private window without storage — nothing gets remembered.
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
        // The class has gone (deleted grade) — the remembered link would lead
        // to a 404, so it's forgotten right away.
        localStorage.removeItem(key)
      }
    } catch {
      // Private window without storage — nothing is found, the tiles stay.
    }
  }, [knownGradeIds, escape, router, key])

  return null
}
