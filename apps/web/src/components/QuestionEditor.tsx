'use client'

import { useId, useState } from 'react'
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
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@testmaker/ui'
import { emptyPayload } from '@/lib/questionDefaults'
import { PayloadFields } from './PayloadFields'

/**
 * Formulář otázky — pole, uložení i chyby, bez dialogu okolo. Vyjmutý
 * z `QuestionEditor`, aby šel použít i jinde než ve vyskakovacím okně (třeba
 * rovnou v řádku seznamu).
 */
export function QuestionEditorForm({
  topicId,
  question,
  onCancel,
  onSaved,
}: {
  topicId: string
  question: Question | null
  onCancel: () => void
  onSaved: (saved?: Question) => void
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
  // Karta v úpravě a „Nová otázka" mohou stát na obrazovce vedle sebe —
  // pevná id by se pak zdvojila a `htmlFor` by mířilo na cizí pole.
  const uid = useId()

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
    <>
      <div className="flex flex-wrap gap-3">
        <div className="w-56">
          <Label htmlFor={`question-editor-type-${uid}`}>Typ</Label>
          <Select value={type} onValueChange={(next) => changeType(next as QuestionType)}>
            <SelectTrigger id={`question-editor-type-${uid}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.filter((t) => t !== 'label_image').map((value) => (
                <SelectItem key={value} value={value}>
                  {QUESTION_TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-24">
          <Label htmlFor={`question-editor-points-${uid}`}>Body</Label>
          <Input
            id={`question-editor-points-${uid}`}
            type="number"
            min={0}
            step={0.5}
            value={points}
            onChange={(event) => setPoints(Number(event.target.value) || 0)}
          />
        </div>
        <div className="w-36">
          <Label htmlFor={`question-editor-difficulty-${uid}`}>Obtížnost</Label>
          <Select
            value={String(difficulty)}
            onValueChange={(next) => setDifficulty(Number(next) as 1 | 2 | 3)}
          >
            <SelectTrigger id={`question-editor-difficulty-${uid}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Lehká</SelectItem>
              <SelectItem value="2">Střední</SelectItem>
              <SelectItem value="3">Těžká</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4">
        <PayloadFields type={type} payload={payload} onChange={setPayload} />
      </div>

      <div className="mt-4">
        <Label htmlFor={`question-editor-explanation-${uid}`}>Poznámka do klíče (nepovinné)</Label>
        <Textarea
          id={`question-editor-explanation-${uid}`}
          value={explanation}
          placeholder="Proč je odpověď správně — vytiskne se jen do klíče pro učitele."
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Zrušit
        </Button>
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? 'Ukládám…' : 'Uložit'}
        </Button>
      </div>
    </>
  )
}

/** Editor jedné otázky v dialogu — vlastní i vygenerované; všechny typy ve stejném formuláři. */
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
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{question ? 'Upravit otázku' : 'Nová otázka'}</DialogTitle>
        </DialogHeader>
        <QuestionEditorForm topicId={topicId} question={question} onCancel={onClose} onSaved={() => onSaved()} />
      </DialogContent>
    </Dialog>
  )
}
