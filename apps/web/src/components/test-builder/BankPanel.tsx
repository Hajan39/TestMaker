'use client'

import type { Question } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
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
import { useMemo } from 'react'
import Link from 'next/link'
import type { PickerTopic } from '@/lib/questionPicker'
import type { BankFilters } from './types'

/**
 * Banka otázek — filtrování napříč předměty a ročníky, zaškrtnutím se otázka
 * přidá do osnovy. Nabízí jen schválené otázky; koncept ani zamítnutou sem
 * server neposílá, takže se filtr na stav nenabízí — nebylo by co filtrovat.
 * U otázky, která v testu už je, přibude počet použití a tlačítko, kterým jde
 * zařadit ještě jednou (rozcvička a pak znovu v jiné části).
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
  /** Kolikrát je která otázka v osnově; chybějící klíč = ani jednou. */
  usedCounts: Map<string, number>
  /** Zaškrtávátko: otázku přidá, nebo vyhodí všechny její výskyty. */
  onToggle: (question: Question) => void
  /** Přidá další výskyt otázky, aniž by se ty stávající dotkl. */
  onAddAgain: (question: Question) => void
  /** Přidá nebo odebere celou skupinu otázek naráz (zaškrtnutí u tématu). */
  onToggleMany: (questions: Question[], add: boolean) => void
}) {
  const isUsed = (id: string) => (usedCounts.get(id) ?? 0) > 0
  const subjects = useMemo(() => [...new Set(topics.map((topic) => topic.subject))].sort(), [topics])
  /**
   * Nabídka ročníků je podle `gradeId`, ne podle názvu — dva ročníky se
   * stejným jménem v různých předmětech ("6. ročník" v matice i v přírodopisu)
   * by se jinak slily do jedné položky a filtr by ukázal obojí najednou.
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
      <h2 className="text-sm font-semibold text-fg">Banka otázek</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Vybírej napříč předměty i ročníky — hodí se pro čtvrtletky a opakování z loňska.
        Jsou tu jen použitelné otázky; smazané se sem nedostanou.
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
              <SelectItem value="vse">Všechny třídy</SelectItem>
              {grades.map(([gradeId, label]) => (
                <SelectItem key={gradeId} value={gradeId}>
                  {label}
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
          topics.every((topic) => topic.questions.length === 0) ? (
            // Prázdná banka není prázdný filtr — učitelka musí vědět, kde otázky vzniknou.
            <EmptyState
              title="V bance zatím nejsou schválené otázky — přidej materiály a schval otázky v Knihovně."
              action={
                <Button asChild variant="outline">
                  <Link href="/">Otevřít Knihovnu</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState title="Žádné otázky neodpovídají filtru" />
          )
        ) : (
          visibleTopics.map((topic) => (
            // Sbalené ve výchozím stavu — u desítek témat by rozbalená banka byla
            // neprůchozí stěna. Téma se samo otevře, jen když z něj je otázka v osnově,
            // ať učitelka hned vidí, odkud si co vzala. Ruční rozbalení jinak zůstává
            // po uživateli (React na `open` sáhne jen když se spočtená hodnota změní).
            <details
              key={topic.id}
              className="rounded border border-line-soft"
              open={topic.questions.some((question) => isUsed(question.id))}
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
                    aria-label={`Vybrat všechny otázky tématu ${topic.label}`}
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
                      {/* Počet použití a přidání dalšího výskytu. Tlačítko je
                          schválně mimo <label>, jinak by klik zároveň přehodil
                          zaškrtávátko a otázku místo přidání odebral. */}
                      {count > 0 ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge variant="secondary" title={`V testu ${count}\u00d7`}>
                            {count}&times;
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2"
                            aria-label="Zařadit do testu ještě jednou"
                            title="Zařadit do testu ještě jednou"
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
