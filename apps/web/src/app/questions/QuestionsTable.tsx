'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { QuestionStatus, QuestionType } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
import {
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'
import type { PickerTopic } from '@/lib/questionPicker'

const STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: 'Koncept',
  approved: 'Schváleno',
  rejected: 'Zamítnuto',
}

interface Row {
  id: string
  prompt: string
  type: QuestionType
  status: QuestionStatus
  points: number
  subject: string
  grade: string
  topicId: string
  topicName: string
}

/** Tabulka všech otázek v knihovně s filtry napříč předměty, typy a stavy. */
export function QuestionsTable({ topics }: { topics: PickerTopic[] }) {
  const rows = useMemo<Row[]>(
    () =>
      topics.flatMap((topic) =>
        topic.questions.map((question) => {
          const payload = question.payload as { prompt?: string; text?: string }
          return {
            id: question.id,
            prompt: payload.prompt ?? payload.text ?? '',
            type: question.type,
            status: question.status,
            points: question.points,
            subject: topic.subject,
            grade: topic.grade,
            topicId: topic.id,
            topicName: topic.name,
          }
        }),
      ),
    [topics],
  )

  const subjects = useMemo(
    () => [...new Set(rows.map((row) => row.subject))].sort((a, b) => a.localeCompare(b, 'cs')),
    [rows],
  )

  const [filters, setFilters] = useState<{
    subject: string
    type: QuestionType | ''
    status: QuestionStatus | ''
    search: string
  }>({ subject: '', type: '', status: '', search: '' })

  const visible = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('cs')
    return rows.filter((row) => {
      if (filters.subject && row.subject !== filters.subject) return false
      if (filters.type && row.type !== filters.type) return false
      if (filters.status && row.status !== filters.status) return false
      if (needle && !row.prompt.toLocaleLowerCase('cs').includes(needle)) return false
      return true
    })
  }, [rows, filters])

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">
          {visible.length} z {rows.length}
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Label htmlFor="q-subject">Předmět</Label>
            <Select
              value={filters.subject || 'vse'}
              onValueChange={(value) => setFilters({ ...filters, subject: value === 'vse' ? '' : value })}
            >
              <SelectTrigger id="q-subject" className="w-full">
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
          <div className="w-44">
            <Label htmlFor="q-type">Typ</Label>
            <Select
              value={filters.type || 'vse'}
              onValueChange={(value) =>
                setFilters({ ...filters, type: value === 'vse' ? '' : (value as QuestionType) })
              }
            >
              <SelectTrigger id="q-type" className="w-full">
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
          <div className="w-36">
            <Label htmlFor="q-status">Stav</Label>
            <Select
              value={filters.status || 'vse'}
              onValueChange={(value) =>
                setFilters({ ...filters, status: value === 'vse' ? '' : (value as QuestionStatus) })
              }
            >
              <SelectTrigger id="q-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechny</SelectItem>
                {Object.entries(STATUS_LABELS).map(([status, label]) => (
                  <SelectItem key={status} value={status}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Label htmlFor="q-search">Hledat</Label>
            <Input
              id="q-search"
              value={filters.search}
              placeholder="text otázky"
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={rows.length === 0 ? 'Banka otázek je prázdná' : 'Filtru nic neodpovídá'}
            hint={
              rows.length === 0
                ? 'Otevři téma a vygeneruj otázky z materiálu, nebo si napiš vlastní.'
                : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line-soft text-fg-muted">
                <th className="py-2 pr-4 font-medium">Otázka</th>
                <th className="py-2 pr-4 font-medium">Typ</th>
                <th className="py-2 pr-4 font-medium">Stav</th>
                <th className="py-2 pr-4 font-medium">Body</th>
                <th className="py-2 pr-4 font-medium">Téma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {visible.map((row) => (
                <tr key={row.id}>
                  <td className="max-w-sm truncate py-2 pr-4 text-fg">{row.prompt}</td>
                  <td className="py-2 pr-4 text-fg-soft">{QUESTION_TYPE_LABELS[row.type]}</td>
                  <td className="py-2 pr-4">
                    {row.status === 'draft' ? <Badge className="bg-draft-bg text-draft-fg">koncept</Badge> : null}
                    {row.status === 'approved' ? <Badge>schváleno</Badge> : null}
                    {row.status === 'rejected' ? <Badge variant="destructive">zamítnuto</Badge> : null}
                  </td>
                  <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.points}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/topics/${row.topicId}`} className="text-brand hover:underline">
                      {[row.subject, row.grade, row.topicName].filter(Boolean).join(' · ')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
