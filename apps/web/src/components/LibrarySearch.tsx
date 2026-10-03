'use client'

import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'use-debounce'
import { queryKeys } from '@/lib/queries'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Delayed, Input, LoadingList } from '@testmaker/ui'
import type { LibrarySearchResult } from '@/lib/library'
import { errorMessage, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

/**
 * Search across the whole library, not just the selected grade. Matches topic
 * names and material file names — for topics like "PL - potravní řetězce" the
 * file name is often more telling than the topic name.
 */
export function LibrarySearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // A short query isn't searched; results aren't cleared, just not shown.
  const needle = query.trim()
  const searching = needle.length >= 2
  // Fast typing doesn't send a request per letter; Query cancels a stale request
  // itself (`signal`), so a slow answer to an older query can't overwrite a newer one.
  const [debounced] = useDebounce(needle, 200)
  const search = useQuery({
    queryKey: queryKeys.library.search(debounced),
    queryFn: ({ signal }) =>
      requestJson<{ results: LibrarySearchResult[] }>(
        `/api/library/search?q=${encodeURIComponent(debounced)}`,
        { signal },
        t('library:search.failed'),
      ),
    enabled: debounced.length >= 2,
    placeholderData: keepPreviousData,
  })
  const results = search.data?.results ?? []
  const loading = search.isFetching
  const error = search.error ? errorMessage(search.error, t('library:search.failed')) : null

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
          placeholder={t('library:search.placeholder')}
          aria-label={t('library:search.label')}
          className="h-8 pl-7 text-sm"
        />
      </div>

      {open && searching ? (
        <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-[var(--radius-outer)] border border-line bg-surface p-1 shadow-lg">
          {loading ? (
            // A skeleton instead of a "Hledám…" message: the menu keeps its
            // height, so it doesn't jump while typing the next letter and results
            // land where one is already looking. It shows only after a delay — a
            // search in a small library finishes before it would be visible.
            <Delayed label={t('library:search.searching')} className="p-1" testId="library-search-loading">
              <LoadingList items={3} />
            </Delayed>
          ) : error ? (
            <p className="px-2 py-2 text-sm text-danger">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-2 text-sm text-fg-muted">{t('library:search.noResults', { query: needle })}</p>
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
                      {result.subjectName} · {result.gradeName || t('library:labels.noGrade')}
                      {result.matchedFileName ? ` · ${t('library:search.matchedFile', { name: result.matchedFileName })}` : ''}
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
