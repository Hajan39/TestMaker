'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { plural, pocet, TEMATA } from '@testmaker/ui'

/** Jak často se lišta ptá, jak generování pokračuje. Jen dokud se něco děje. */
const REFRESH_MS = 5000

/**
 * Událost, kterou aplikace ohlásí, že se právě začalo generovat. Lišta se díky
 * ní ozve hned, i když se nikam nepřechází.
 */
export const GENERATION_STARTED = 'testmaker:generovani'

/** Ohlásí lišty, že začala nová práce. */
export function announceGeneration(): void {
  window.dispatchEvent(new Event(GENERATION_STARTED))
}

interface Counts {
  running: number
  queued: number
  /** Nedokončená témata. Zůstávají viset i den poté, co se vyčerpal limit modelu. */
  error: number
  /** Téma jediné běžící nebo čekající úlohy, když nic neselhalo. */
  topicId?: string
}

/**
 * Tichá zprávička v horní liště: generuje se a kolika témat se to ještě týká.
 * Vede na přehled generování, takže se dá z tématu odejít a pořád vědět, jak
 * to dopadá.
 *
 * Zůstává i po doběhnutí, pokud nějaké téma zůstalo nedokončené — jinou,
 * klidnou větou a bez kolečka. Právě tehdy je přehled potřeba nejvíc:
 * nejčastější důvod zastavení je vyčerpaný denní limit modelu a učitelka se
 * k nedodělané práci vrací až druhý den, kdy už nic neběží.
 *
 * Dotazuje se šetrně: jednou při každém přechodu mezi stránkami, dál pak jen
 * tehdy, když se opravdu něco děje.
 */
export function GenerationStatus({ pathname }: { pathname: string }) {
  const [counts, setCounts] = useState<Counts>({ running: 0, queued: 0, error: 0 })
  const busy = counts.running > 0 || counts.queued > 0

  /**
   * Čte počty. Stav se nastavuje až v odpovědi na výsledek, ne uvnitř těla
   * efektu — jinak se překresluje kolem dokola.
   */
  const readCounts = useCallback(async (): Promise<Counts | null> => {
    try {
      const response = await fetch('/api/jobs')
      if (!response.ok) return null
      const data = (await response.json()) as Partial<Counts>
      return {
        running: data.running ?? 0,
        queued: data.queued ?? 0,
        error: data.error ?? 0,
        topicId: data.topicId,
      }
    } catch {
      // Ukazatel v liště je doplněk; když se nenačte, nic se neděje.
      return null
    }
  }, [])

  // Při každém přechodu mezi stránkami jednou — a hned, jak se někde začne
  // generovat.
  useEffect(() => {
    let platne = true
    const load = () => {
      void readCounts().then((next) => {
        if (platne && next) setCounts(next)
      })
    }

    load()
    window.addEventListener(GENERATION_STARTED, load)
    // Opakovaně se ptá jen za běhu. Dokud se nic negeneruje, nemá se co měnit.
    const timer = busy ? setInterval(load, REFRESH_MS) : null
    return () => {
      platne = false
      window.removeEventListener(GENERATION_STARTED, load)
      if (timer) clearInterval(timer)
    }
  }, [pathname, busy, readCounts])

  if (!busy && counts.error === 0) return null

  // Tři věty pro tři situace: něco se tvoří, něco čeká na řadu, nebo se
  // nedělá nic a jen zbyla nedodělaná témata.
  const text = busy
    ? counts.running > 0
      ? `Generuji otázky${counts.queued > 0 ? `, čeká ještě ${pocet(counts.queued, TEMATA)}` : ''}`
      : `Ve frontě čeká ${pocet(counts.queued, TEMATA)}`
    : `${pocet(counts.error, TEMATA)} ${plural(counts.error, 'se nedokončilo', 'se nedokončila', 'se nedokončilo')}`

  // Jde o právě jedno téma a nic neselhalo: ukazatel vede rovnou do něj,
  // ne do obecného přehledu, kam by se pak muselo proklikávat dál.
  const href = counts.topicId ? `/topics/${counts.topicId}` : '/generovani'

  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-[var(--radius-inner)] px-2 py-1 text-xs text-fg-muted hover:text-fg"
      title={counts.topicId ? 'Otevřít téma' : 'Přehled generování'}
    >
      {/* Kolečko patří jen k práci, která opravdu běží. U nedokončených témat
          by se točilo nad něčím, co stojí. */}
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {text}
    </Link>
  )
}
