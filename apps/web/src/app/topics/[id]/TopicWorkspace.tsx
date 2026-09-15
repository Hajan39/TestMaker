'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionStatus, QuestionType } from '@testmaker/core/schema'
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
import {
  AiUnavailable,
  DEFAULT_SETTINGS,
  GenerateSettingsForm,
  ProgressLine,
  type GenerateSettings,
} from '@/components/GenerateDialog'
import { QuestionEditor } from '@/components/QuestionEditor'
import { generateQuestionsStream } from '@/lib/generateClient'

interface MaterialSummary {
  id: string
  fileName: string
  charCount: number
}

export function TopicWorkspace({
  topicId,
  topicName,
  materials,
  questions,
  ai,
}: {
  topicId: string
  topicName: string
  materials: MaterialSummary[]
  questions: Question[]
  ai: { configured: boolean; provider: string; model: string }
}) {
  const router = useRouter()
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Question | 'new' | null>(null)
  const [filters, setFilters] = useState<{ type: QuestionType | ''; status: QuestionStatus | ''; search: string }>({
    type: '',
    status: '',
    search: '',
  })
  const abortRef = useRef<AbortController | null>(null)

  const totalChars = materials.reduce((sum, material) => sum + material.charCount, 0)

  const visible = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('cs')
    return questions.filter((question) => {
      if (filters.type && question.type !== filters.type) return false
      if (filters.status && question.status !== filters.status) return false
      if (needle && !JSON.stringify(question.payload).toLocaleLowerCase('cs').includes(needle)) return false
      return true
    })
  }, [questions, filters])

  async function generate() {
    setError(null)
    setGenerating(true)
    setStatus('Generuji…')
    abortRef.current = new AbortController()
    try {
      await generateQuestionsStream({ topicId, ...settings }, (event) => {
        if (event.type === 'progress') setStatus(`Zpracovávám část ${event.done} z ${event.total}`)
        else if (event.type === 'done') {
          setStatus(
            `Vytvořeno ${event.created} otázek z ${event.sources} materiálů` +
              (event.rejected > 0 ? `, ${event.rejected} zahozeno` : ''),
          )
          router.refresh()
        } else if (event.type === 'error') setError(event.message)
      }, abortRef.current.signal)
    } catch (streamError) {
      setError(streamError instanceof Error ? streamError.message : String(streamError))
    } finally {
      setGenerating(false)
    }
  }

  async function bulkStatus(next: QuestionStatus) {
    if (selected.size === 0) return
    await fetch('/api/questions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [...selected], status: next }),
    })
    setSelected(new Set())
    router.refresh()
  }

  async function removeSelected() {
    if (selected.size === 0) return
    const query = [...selected].map((id) => `id=${encodeURIComponent(id)}`).join('&')
    await fetch(`/api/questions?${query}`, { method: 'DELETE' })
    setSelected(new Set())
    router.refresh()
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-fg">Generovat otázky</h2>
        {ai.configured ? (
          <>
            <p className="mt-1 text-sm text-fg-muted">
              Zdrojem je celá skupina „{topicName}“: {materials.length}{' '}
              {materials.length === 1 ? 'materiál' : 'materiálů'},{' '}
              {totalChars.toLocaleString('cs')} znaků. Model {ai.model} dostane všechny naráz, aby se
              otázky neopakovaly. Vzniknou jako koncepty ke schválení.
            </p>
            <div className="mt-3">
              <GenerateSettingsForm value={settings} onChange={setSettings} disabled={generating} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button disabled={generating || materials.length === 0} onClick={() => void generate()}>
                Vygenerovat ze skupiny
              </Button>
              {generating ? <ProgressLine label={status ?? 'Generuji…'} /> : null}
              {!generating && status ? <span className="text-sm text-brand">{status}</span> : null}
            </div>
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          </>
        ) : (
          <div className="mt-3">
            <AiUnavailable provider={ai.provider} />
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Otázky ({questions.length})</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <Label htmlFor="question-type-filter">Typ</Label>
              <Select
                value={filters.type || 'vse'}
                onValueChange={(value) =>
                  setFilters({ ...filters, type: value === 'vse' ? '' : (value as QuestionType) })
                }
              >
                <SelectTrigger id="question-type-filter" className="w-full">
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
              <Label htmlFor="question-status-filter">Stav</Label>
              <Select
                value={filters.status || 'vse'}
                onValueChange={(value) =>
                  setFilters({ ...filters, status: value === 'vse' ? '' : (value as QuestionStatus) })
                }
              >
                <SelectTrigger id="question-status-filter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Všechny</SelectItem>
                  <SelectItem value="draft">Koncept</SelectItem>
                  <SelectItem value="approved">Schválené</SelectItem>
                  <SelectItem value="rejected">Zamítnuté</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Label htmlFor="question-search-filter">Hledat</Label>
              <Input
                id="question-search-filter"
                value={filters.search}
                placeholder="text otázky"
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              Vlastní otázka
            </Button>
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-surface-muted px-3 py-2">
            <span className="text-sm text-fg-soft">Vybráno {selected.size}</span>
            <Button size="sm" onClick={() => void bulkStatus('approved')}>
              Schválit
            </Button>
            <Button size="sm" variant="outline" onClick={() => void bulkStatus('rejected')}>
              Zamítnout
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void removeSelected()}>
              Smazat
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Zrušit výběr
            </Button>
          </div>
        ) : null}

        {visible.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={questions.length === 0 ? 'K tématu zatím nejsou otázky' : 'Filtru nic neodpovídá'}
              hint={questions.length === 0 ? 'Vygeneruj je ze skupiny materiálů, nebo přidej vlastní.' : undefined}
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {visible.map((question) => (
              <li key={question.id} className="flex gap-3 py-3">
                <Checkbox
                  className="mt-1"
                  checked={selected.has(question.id)}
                  onCheckedChange={() => toggle(question.id)}
                />
                <div className="min-w-0 flex-1">
                  <QuestionPreview question={question} />
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {question.status === 'draft' ? (
                    <Badge className="bg-draft-bg text-draft-fg">koncept</Badge>
                  ) : null}
                  {question.status === 'rejected' ? <Badge variant="destructive">zamítnuto</Badge> : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(question)}>
                    Upravit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing ? (
        <QuestionEditor
          topicId={topicId}
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
