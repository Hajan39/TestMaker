'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Delayed, Input, LoadingList } from '@testmaker/ui'
import type { LibrarySearchResult } from '@/lib/library'

/**
 * Hledání přes celou knihovnu, ne jen ve zvoleném ročníku. Hledá v názvech
 * témat i v názvech materiálů — u témat jako „PL - potravní řetězce" bývá
 * název souboru výmluvnější než název tématu.
 */
export function LibrarySearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibrarySearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Krátký dotaz se nehledá; výsledky se neukládají prázdné, jen se nezobrazí.
  // (Nastavovat stav rovnou v efektu vede na řetězení překreslení.)
  const needle = query.trim()
  const searching = needle.length >= 2

  useEffect(() => {
    if (needle.length < 2) return
    // `setLoading` až uvnitř časovače: stav se nemá měnit synchronně v efektu
    // (React to hlásí jako řetězení překreslení) a u rychlého psaní se tak
    // hláška „Hledám…" ani neukáže zbytečně.
    const timeout = setTimeout(() => {
      setLoading(true)
      fetch(`/api/library/search?q=${encodeURIComponent(needle)}`)
        .then((response) => response.json())
        .then((data: { results: LibrarySearchResult[] }) => setResults(data.results))
        .finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(timeout)
  }, [needle])

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function select(topicId: string) {
    setOpen(false)
    setQuery('')
    router.push(`/topics/${topicId}`)
  }

  return (
    <div ref={containerRef} className="relative px-2 pb-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Hledat v celé knihovně…"
          aria-label="Hledat v celé knihovně"
          className="h-8 pl-7 text-sm"
        />
      </div>

      {open && searching ? (
        <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-[var(--radius-outer)] border border-line bg-surface p-1 shadow-lg">
          {loading ? (
            // Kostra místo hlášky „Hledám…“: nabídka si udrží výšku, takže při
            // psaní dalšího písmene neposkakuje a výsledky naskočí na místo,
            // kam se člověk už dívá. Ukáže se až po prodlevě — hledání v malé
            // knihovně je hotové dřív, než by ji bylo vidět.
            <Delayed label="Hledám…" className="p-1">
              <LoadingList items={3} />
            </Delayed>
          ) : results.length === 0 ? (
            <p className="px-2 py-2 text-sm text-fg-muted">Nic neodpovídá hledání „{needle}&ldquo;.</p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((result) => (
                <li key={result.topicId}>
                  <button
                    type="button"
                    className="block w-full rounded-[var(--radius-inner)] px-2 py-1.5 text-left hover:bg-surface-muted"
                    onClick={() => select(result.topicId)}
                  >
                    <span className="block truncate text-sm text-fg">{result.topicName}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {result.subjectName} · {result.gradeName || 'Bez ročníku'}
                      {result.matchedFileName ? ` · soubor „${result.matchedFileName}"` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
