'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'

/** Jak dlouho se čeká, než se psaní v hledání promítne do adresy. */
const SEARCH_DELAY = 350

/**
 * Hledání a filtr nad seznamem testů.
 *
 * Filtry jsou v adrese, aby se dal odkaz poslat a aby se šlo vrátit zpátky
 * tam, kde učitelka skončila; samotné hledání dělá databáze, seznam se sem
 * nenačítá celý.
 */
export function TestsFilters({
  search,
  templateId,
  templates,
}: {
  search: string
  templateId: string
  templates: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [text, setText] = useState(search)
  const [navigating, startNavigate] = useTransition()
  const [applied, setApplied] = useState(search)

  // Změna adresy zvenčí (tlačítko zpět, poslaný odkaz) se musí propsat do
  // políčka, jinak by ukazovalo, co už neplatí. Srovnává se při vykreslení,
  // ne v efektu — jinak by políčko na okamžik ukázalo starý text.
  if (applied !== search) {
    setApplied(search)
    setText(search)
  }

  const apply = useCallback(
    (next: { search: string; templateId: string }) => {
      const params = new URLSearchParams()
      if (next.search.trim()) params.set('q', next.search.trim())
      if (next.templateId) params.set('templateId', next.templateId)
      const query = params.toString()
      startNavigate(() => router.push(query ? `/tests?${query}` : '/tests', { scroll: false }))
    },
    [router],
  )

  // Psaní se do adresy propisuje se zpožděním, aby se seznam nenačítal po
  // každém písmenu.
  useEffect(() => {
    if (text === search) return
    const timer = setTimeout(() => apply({ search: text, templateId }), SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [text, search, templateId, apply])

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-56">
        <Label htmlFor="test-search">Hledat</Label>
        <Input
          id="test-search"
          value={text}
          placeholder="název testu"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="w-52">
        <Label htmlFor="test-template">Šablona</Label>
        <Select
          value={templateId || 'vse'}
          onValueChange={(value) =>
            apply({ search: text, templateId: value === 'vse' ? '' : value })
          }
        >
          <SelectTrigger id="test-template" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vse">Všechny</SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {navigating ? <p className="pb-2 text-sm text-fg-muted">Hledám…</p> : null}
    </div>
  )
}
