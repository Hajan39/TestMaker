'use client'

import type { Question } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
import {
  Card,
  Checkbox,
  EmptyState,
  Input,
  Label,
  QuestionPreview,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'
import { useMemo } from 'react'
import type { PickerTopic } from '@/lib/questionPicker'
import type { BankFilters } from './types'

/** Banka otázek — filtrování napříč předměty a ročníky, zaškrtnutím se otázka přidá do osnovy. */
export function BankPanel({
  topics,
  filters,
  onFiltersChange,
  usedIds,
  onToggle,
  onToggleMany,
}: {
  topics: PickerTopic[]
  filters: BankFilters
  onFiltersChange: (next: BankFilters) => void
  usedIds: Set<string>
  onToggle: (question: Question) => void
  /** Přidá nebo odebere celou skupinu otázek naráz (zaškrtnutí u tématu). */
  onToggleMany: (questions: Question[], add: boolean) => void
}) {
  const subjects = useMemo(() => [...new Set(topics.map((topic) => topic.subject))].sort(), [topics])
  const grades = useMemo(() => [...new Set(topics.map((topic) => topic.grade))].sort(), [topics])

  const visibleTopics = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('cs')
    return topics
      .filter((topic) => !filters.subject || topic.subject === filters.subject)
      .filter((topic) => !filters.grade || topic.grade === filters.grade)
      .map((topic) => ({
        ...topic,
        questions: topic.questions.filter((question) => {
          if (filters.type && question.type !== filters.type) return false
          if (filters.onlyApproved && question.status !== 'approved') return false
          if (needle) {
            const haystack = `${topic.label} ${JSON.stringify(question.payload)}`.toLocaleLowerCase('cs')
            if (!haystack.includes(needle)) return false
          }
          return true
        }),
      }))
      .filter((topic) => topic.questions.length > 0)
  }, [topics, filters])

  const visibleQuestions = useMemo(
    () => visibleTopics.flatMap((topic) => topic.questions),
    [visibleTopics],
  )
  const allVisibleUsed =
    visibleQuestions.length > 0 && visibleQuestions.every((question) => usedIds.has(question.id))
  const someVisibleUsed = visibleQuestions.some((question) => usedIds.has(question.id))

  return (
    <Card className="flex h-full flex-col p-4">
      <h2 className="text-sm font-semibold text-fg">Banka otázek</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Vybírej napříč předměty i ročníky — hodí se pro čtvrtletky a opakování z loňska.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="w-36">
          <Label htmlFor="bank-subject-filter">Předmět</Label>
          <Select
            value={filters.subject || 'vse'}
            onValueChange={(value) => onFiltersChange({ ...filters, subject: value === 'vse' ? '' : value })}
          >
            <SelectTrigger id="bank-subject-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vse">Všechny</SelectItem>
              {subjects.map((subject) => (
                <SelectItem key={subject} value={subject}>
                  {subject}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <Label htmlFor="bank-grade-filter">Ročník</Label>
          <Select
            value={filters.grade || 'vse'}
            onValueChange={(value) => onFiltersChange({ ...filters, grade: value === 'vse' ? '' : value })}
          >
            <SelectTrigger id="bank-grade-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vse">Všechny</SelectItem>
              {grades.map((grade) => (
                <SelectItem key={grade} value={grade}>
                  {grade}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label htmlFor="bank-type-filter">Typ</Label>
          <Select
            value={filters.type || 'vse'}
            onValueChange={(value) => onFiltersChange({ ...filters, type: value === 'vse' ? '' : value })}
          >
            <SelectTrigger id="bank-type-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vse">Všechny</SelectItem>
              {Object.entries(QUESTION_TYPE_LABELS).map(([type, label]) => (
                <SelectItem key={type} value={type}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label htmlFor="bank-search-filter">Hledat</Label>
          <Input
            id="bank-search-filter"
            value={filters.search}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg-soft">
          <Checkbox
            checked={filters.onlyApproved}
            onCheckedChange={() => onFiltersChange({ ...filters, onlyApproved: !filters.onlyApproved })}
          />
          jen schválené
        </label>
      </div>

      {visibleQuestions.length > 0 ? (
        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-fg-soft">
          <Checkbox
            checked={allVisibleUsed ? true : someVisibleUsed ? 'indeterminate' : false}
            onCheckedChange={() => onToggleMany(visibleQuestions, !allVisibleUsed)}
            aria-label="Vybrat vše"
          />
          Vybrat vše ({visibleQuestions.length})
        </label>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {visibleTopics.length === 0 ? (
          <EmptyState title="Žádné otázky neodpovídají filtru" />
        ) : (
          visibleTopics.map((topic) => (
            // Sbalené ve výchozím stavu — u desítek témat by rozbalená banka byla
            // neprůchozí stěna. Téma se samo otevře, jen když z něj je otázka v osnově,
            // ať učitelka hned vidí, odkud si co vzala. Ruční rozbalení jinak zůstává
            // po uživateli (React na `open` sáhne jen když se spočtená hodnota změní).
            <details
              key={topic.id}
              className="rounded border border-line-soft"
              open={topic.questions.some((question) => usedIds.has(question.id))}
            >
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-fg-soft">
                {/* Zaškrtnutí u tématu bere všechny jeho otázky, které projdou
                    filtrem — u opakování z celého ročníku by jinak byla práce
                    v klikání po jedné. `stopPropagation` brání tomu, aby se
                    tématem zároveň rozbalovalo. */}
                <span
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="flex items-center"
                >
                  <Checkbox
                    checked={
                      topic.questions.every((question) => usedIds.has(question.id))
                        ? true
                        : topic.questions.some((question) => usedIds.has(question.id))
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={() =>
                      onToggleMany(
                        topic.questions,
                        !topic.questions.every((question) => usedIds.has(question.id)),
                      )
                    }
                    aria-label={`Vybrat všechny otázky tématu ${topic.label}`}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {topic.label} <span className="font-normal text-fg-muted">({topic.questions.length})</span>
                </span>
              </summary>
              <ul className="divide-y divide-line-soft px-3 pb-2">
                {topic.questions.map((question) => (
                  <li key={question.id} className="flex gap-2 py-2">
                    <label className="flex min-w-0 flex-1 items-start gap-2">
                      <Checkbox
                        className="mt-0.5"
                        checked={usedIds.has(question.id)}
                        onCheckedChange={() => onToggle(question)}
                      />
                      <div className="min-w-0 flex-1">
                        <QuestionPreview question={question} showAnswers={false} />
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </div>
    </Card>
  )
}
