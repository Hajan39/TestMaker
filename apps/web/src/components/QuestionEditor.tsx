'use client'

import { useState } from 'react'
import {
  DEFAULT_POINTS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  questionContentSchema,
  validateQuestionContent,
  type Question,
  type QuestionContent,
  type QuestionType,
} from '@testmaker/core/schema'
import { Button, Card, Input, Label, Select, Textarea } from '@testmaker/ui'
import { emptyPayload } from '@/lib/questionDefaults'
import { PayloadFields } from './PayloadFields'

/** Editor jedné otázky — vlastní i vygenerované; všechny typy ve stejném dialogu. */
export function QuestionEditor({
  topicId,
  question,
  onClose,
  onSaved,
}: {
  topicId: string
  question: Question | null
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<QuestionType>(question?.type ?? 'single_choice')
  const [payload, setPayload] = useState<Record<string, unknown>>(
    question ? (question.payload as Record<string, unknown>) : emptyPayload('single_choice'),
  )
  const [points, setPoints] = useState(question?.points ?? DEFAULT_POINTS.single_choice)
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(question?.difficulty ?? 2)
  const [explanation, setExplanation] = useState(question?.explanation ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function changeType(next: QuestionType) {
    setType(next)
    setPayload(emptyPayload(next))
    setPoints(DEFAULT_POINTS[next])
  }

  async function save() {
    setError(null)
    const candidate = {
      type,
      payload,
      points,
      difficulty,
      explanation: explanation.trim() || undefined,
      blocks: question?.blocks ?? [],
    }

    const parsed = questionContentSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
      return
    }
    const problems = validateQuestionContent(parsed.data as QuestionContent)
    if (problems.length > 0) {
      setError(problems.join('; '))
      return
    }

    setSaving(true)
    try {
      const response = question
        ? await fetch('/api/questions', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: question.id, question: parsed.data }),
          })
        : await fetch('/api/questions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ topicId, question: parsed.data }),
          })
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(detail.error ?? `Uložení selhalo (${response.status})`)
      }
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4">
      <Card className="w-full max-w-3xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">
            {question ? 'Upravit otázku' : 'Nová otázka'}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Zavřít
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="w-56">
            <Label>Typ</Label>
            <Select value={type} onChange={(event) => changeType(event.target.value as QuestionType)}>
              {QUESTION_TYPES.filter((t) => t !== 'label_image').map((value) => (
                <option key={value} value={value}>
                  {QUESTION_TYPE_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-24">
            <Label>Body</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value) || 0)}
            />
          </div>
          <div className="w-36">
            <Label>Obtížnost</Label>
            <Select
              value={String(difficulty)}
              onChange={(event) => setDifficulty(Number(event.target.value) as 1 | 2 | 3)}
            >
              <option value="1">Lehká</option>
              <option value="2">Střední</option>
              <option value="3">Těžká</option>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          <PayloadFields type={type} payload={payload} onChange={setPayload} />
        </div>

        <div className="mt-4">
          <Label>Poznámka do klíče (nepovinné)</Label>
          <Textarea
            value={explanation}
            placeholder="Proč je odpověď správně — vytiskne se jen do klíče pro učitele."
            onChange={(event) => setExplanation(event.target.value)}
          />
        </div>

        {error ? <p className="mt-3 text-sm text-danger-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Zrušit</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Ukládám…' : 'Uložit'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
