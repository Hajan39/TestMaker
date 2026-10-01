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
import { t } from '@testmaker/core/i18n'

/** How long to wait before typing in the search reaches the URL. */
const SEARCH_DELAY = 350

/**
 * Search and filter over the test list.
 *
 * Filters live in the URL so a link can be shared and the teacher can get back
 * to where she left off; the database does the search itself, the whole list
 * is never loaded here.
 */
export function TestsFilters({
  basePath,
  search,
  templateId,
  templates,
  gradeId,
  grades,
}: {
  /** `/tests` or `/listy` — the filter stays on the overview it came from. */
  basePath: string
  search: string
  templateId: string
  templates: { id: string; name: string }[]
  gradeId: string
  grades: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [text, setText] = useState(search)
  const [navigating, startNavigate] = useTransition()
  const [applied, setApplied] = useState(search)

  // A URL change from outside (back button, shared link) must reach the field,
  // otherwise it would show stale text. Synced during render, not in an
  // effect — otherwise the field would briefly show the old text.
  if (applied !== search) {
    setApplied(search)
    setText(search)
  }

  const apply = useCallback(
    (next: { search: string; templateId: string; gradeId: string }) => {
      const params = new URLSearchParams()
      if (next.search.trim()) params.set('q', next.search.trim())
      if (next.templateId) params.set('templateId', next.templateId)
      if (next.gradeId) params.set('trida', next.gradeId)
      const query = params.toString()
      startNavigate(() => router.push(query ? `${basePath}?${query}` : basePath, { scroll: false }))
    },
    [router, basePath],
  )

  // Typing reaches the URL with a delay so the list does not reload on every
  // keystroke.
  useEffect(() => {
    if (text === search) return
    const timer = setTimeout(() => apply({ search: text, templateId, gradeId }), SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [text, search, templateId, gradeId, apply])

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-56">
        <Label htmlFor="test-search">{t('tests:filters.search')}</Label>
        <Input
          id="test-search"
          value={text}
          placeholder={t('tests:filters.searchPlaceholder')}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="w-52">
        <Label htmlFor="test-template">{t('tests:filters.template')}</Label>
        <Select
          value={templateId || 'vse'}
          onValueChange={(value) =>
            apply({ search: text, templateId: value === 'vse' ? '' : value, gradeId })
          }
        >
          <SelectTrigger id="test-template" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vse">{t('tests:filters.allTemplates')}</SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-52">
        <Label htmlFor="test-grade">{t('tests:filters.grade')}</Label>
        <Select
          value={gradeId || 'vse'}
          onValueChange={(value) =>
            apply({ search: text, templateId, gradeId: value === 'vse' ? '' : value })
          }
        >
          <SelectTrigger id="test-grade" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vse">{t('tests:filters.allGrades')}</SelectItem>
            {grades.map((grade) => (
              <SelectItem key={grade.id} value={grade.id}>
                {grade.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {navigating ? <p className="pb-2 text-sm text-fg-muted">{t('tests:filters.searching')}</p> : null}
    </div>
  )
}
