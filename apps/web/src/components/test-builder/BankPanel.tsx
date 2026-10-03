'use client'

import type { Question } from '@testmaker/core/schema'
import { QUESTION_TYPES, questionTypeLabel } from '@testmaker/core/schema'
import {
  Badge,
  Button,
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
import { t } from '@testmaker/core/i18n'
import { useMemo } from 'react'
import Link from 'next/link'
import type { PickerTopic } from '@/lib/questionPicker'
import type { BankFilters } from './types'

/**
 * Question bank — filtering across subjects and grades; ticking a question adds
 * it to the outline. Only approved questions are offered; the server never
 * sends drafts or rejected ones, so there is no status filter — nothing to
 * filter. A question already in the test gets a usage count and a button to
 * add it once more (a warm-up and again in another part).
 */
export function BankPanel({
  topics,
  filters,
  onFiltersChange,
  usedCounts,
  onToggle,
  onAddAgain,
  onToggleMany,
}: {
  topics: PickerTopic[]
  filters: BankFilters
  onFiltersChange: (next: BankFilters) => void
  /** How many times each question is in the outline; missing key = none. */
  usedCounts: Map<string, number>
  /** Checkbox: adds the question or removes all its occurrences. */
  onToggle: (question: Question) => void
  /** Adds another occurrence of the question without touching existing ones. */
  onAddAgain: (question: Question) => void
  /** Adds or removes a whole group of questions at once (topic checkbox). */
  onToggleMany: (questions: Question[], add: boolean) => void
}) {
  const isUsed = (id: string) => (usedCounts.get(id) ?? 0) > 0
  const subjects = useMemo(() => [...new Set(topics.map((topic) => topic.subject))].sort(), [topics])
  /**
   * Grade options are keyed by `gradeId`, not name — two grades with the same
   * name in different subjects ("6. ročník" in maths and in biology) would
   * otherwise merge into one option and the filter would show both at once.
   */
  const grades = useMemo(() => {
    const byId = new Map<string, string>()
    for (const topic of topics) {
      if (!byId.has(topic.gradeId)) byId.set(topic.gradeId, `${topic.subject} · ${topic.grade}`)
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'cs'))
  }, [topics])

  const visibleTopics = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('cs')
    return topics
      .filter((topic) => !filters.subject || topic.subject === filters.subject)
      .filter((topic) => !filters.grade || topic.gradeId === filters.grade)
      .map((topic) => ({
        ...topic,
        questions: topic.questions.filter((question) => {
          if (filters.type && question.type !== filters.type) return false
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
    visibleQuestions.length > 0 && visibleQuestions.every((question) => isUsed(question.id))
  const someVisibleUsed = visibleQuestions.some((question) => isUsed(question.id))

  return (
    <Card className="flex h-full flex-col p-4">
      <h2 className="text-sm font-semibold text-fg">{t('tests:bank.title')}</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {t('tests:bank.intro')}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="w-36">
          <Label htmlFor="bank-subject-filter">{t('tests:bank.subject')}</Label>
          <Select
            value={filters.subject || 'vse'}
            onValueChange={(value) => onFiltersChange({ ...filters, subject: value === 'vse' ? '' : value })}
          >
            <SelectTrigger id="bank-subject-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vse">{t('tests:filters.allTemplates')}</SelectItem>
              {subjects.map((subject) => (
                <SelectItem key={subject} value={subject}>
                  {subject}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <Label htmlFor="bank-grade-filter">{t('tests:bank.grade')}</Label>
          <Select
            value={filters.grade || 'vse'}
            onValueChange={(value) => onFiltersChange({ ...filters, grade: value === 'vse' ? '' : value })}
          >
            <SelectTrigger id="bank-grade-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vse">{t('tests:filters.allGrades')}</SelectItem>
              {grades.map(([gradeId, label]) => (
                <SelectItem key={gradeId} value={gradeId}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label htmlFor="bank-type-filter">{t('tests:bank.type')}</Label>
          <Select
            value={filters.type || 'vse'}
            onValueChange={(value) => onFiltersChange({ ...filters, type: value === 'vse' ? '' : value })}
          >
            <SelectTrigger id="bank-type-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vse">{t('tests:filters.allTemplates')}</SelectItem>
              {QUESTION_TYPES.map((type) => [type, questionTypeLabel(type)] as const).map(([type, label]) => (
                <SelectItem key={type} value={type}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label htmlFor="bank-search-filter">{t('tests:filters.search')}</Label>
          <Input
            id="bank-search-filter"
            value={filters.search}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          />
        </div>
      </div>

      {visibleQuestions.length > 0 ? (
        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-fg-soft">
          <Checkbox
            checked={allVisibleUsed ? true : someVisibleUsed ? 'indeterminate' : false}
            onCheckedChange={() => onToggleMany(visibleQuestions, !allVisibleUsed)}
            aria-label={t('tests:bank.selectAll')}
          />
          {t('tests:bank.selectAllCount', { count: visibleQuestions.length })}
        </label>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {visibleTopics.length === 0 ? (
          topics.every((topic) => topic.questions.length === 0) ? (
            // An empty bank is not an empty filter — the teacher needs to know where questions come from.
            <EmptyState
              title={t('tests:bank.empty')}
              action={
                <Button asChild variant="outline">
                  <Link href="/">{t('tests:bank.openLibrary')}</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState title={t('tests:bank.noMatch')} />
          )
        ) : (
          visibleTopics.map((topic) => (
            // Collapsed by default — with dozens of topics an expanded bank would be an
            // impassable wall. A topic opens by itself only when one of its questions is
            // in the outline, so the teacher sees where things came from. Manual expanding
            // is otherwise kept (React only touches `open` when the computed value changes).
            <details
              key={topic.id}
              className="rounded border border-line-soft"
              open={topic.questions.some((question) => isUsed(question.id))}
            >
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-fg-soft">
                {/* The topic checkbox takes all its questions that pass the
                    filter — for a review of a whole grade it would otherwise be
                    clicking one by one. `stopPropagation` keeps it from also
                    toggling the topic open. */}
                <span
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="flex items-center"
                >
                  <Checkbox
                    checked={
                      topic.questions.every((question) => isUsed(question.id))
                        ? true
                        : topic.questions.some((question) => isUsed(question.id))
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={() =>
                      onToggleMany(
                        topic.questions,
                        !topic.questions.every((question) => isUsed(question.id)),
                      )
                    }
                    aria-label={t('tests:bank.selectTopic', { topic: topic.label })}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {topic.label} <span className="font-normal text-fg-muted">({topic.questions.length})</span>
                </span>
              </summary>
              <ul className="divide-y divide-line-soft px-3 pb-2">
                {topic.questions.map((question) => {
                  const count = usedCounts.get(question.id) ?? 0
                  return (
                    <li key={question.id} className="flex items-start gap-2 py-2">
                      <label className="flex min-w-0 flex-1 items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={count > 0}
                          onCheckedChange={() => onToggle(question)}
                        />
                        <div className="min-w-0 flex-1">
                          <QuestionPreview question={question} showAnswers={false} />
                        </div>
                      </label>
                      {/* Usage count and adding another occurrence. The button is
                          deliberately outside <label>, otherwise the click would
                          also flip the checkbox and remove the question instead. */}
                      {count > 0 ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge variant="secondary" title={t('tests:bank.usedTimes', { count })} data-testid="question-used-count" data-count={count}>
                            {count}&times;
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2"
                            aria-label={t('tests:bank.addAgain')}
                            title={t('tests:bank.addAgain')}
                            onClick={() => onAddAgain(question)}
                          >
                            +
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </details>
          ))
        )}
      </div>
    </Card>
  )
}
