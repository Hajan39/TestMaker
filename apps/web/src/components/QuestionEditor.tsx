'use client'

import { useId, useState } from 'react'
import {
  DEFAULT_POINTS,
  questionTypeLabel,
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
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { PayloadFields } from './PayloadFields'
import { t } from '@testmaker/core/i18n'

/**
 * What to fix, by the field zod rejected. Zod's English message with a path
 * like „payload.options.1: String must contain…“ tells the teacher nothing.
 */
const PROBLEM_FIELDS = ['prompt', 'options', 'correctIndex', 'correctIndices', 'answer', 'acceptedAnswers', 'statements', 'text', 'blanks', 'wordBank', 'left', 'right', 'pairs', 'items', 'headers', 'rows', 'answers', 'lines', 'points', 'explanation'] as const
type ProblemField = (typeof PROBLEM_FIELDS)[number]

function fieldProblem(field: string): string {
  return (PROBLEM_FIELDS as readonly string[]).includes(field)
    ? t(`library:questionEditor.problems.${field as ProblemField}`)
    : t('library:questionEditor.problems.incomplete')
}

function describeIssues(paths: PropertyKey[][]): string {
  const messages = new Set(
    paths.map((path) => {
      // `payload.options.1` → `options`, `points` → `points`.
      const field = String(path[0] === 'payload' ? path[1] : path[0])
      return fieldProblem(field)
    }),
  )
  return [...messages].join(' ')
}

/**
 * The question form — fields, saving and errors, without a surrounding
 * dialog. Extracted from `QuestionEditor` so it can be used outside a popup
 * too (e.g. right in a list row).
 */
export function QuestionEditorForm({
  topicId,
  question,
  onCancel,
  onSaved,
  onSubmit,
}: {
  topicId: string
  question: Question | null
  onCancel: () => void
  onSaved: (saved?: Question) => void
  /**
   * Hands the content to the caller instead of saving it to the bank — a
   * worksheet task lives only in the worksheet item's snapshot and does not
   * belong in the bank. Points are not offered then; worksheets are not graded.
   */
  onSubmit?: (content: QuestionContent) => void
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
  // A card being edited and „Nová otázka" can be on screen side by side —
  // fixed ids would then repeat and `htmlFor` would point at another field.
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
      setError(describeIssues(parsed.error.issues.map((issue) => issue.path)))
      return
    }
    const problems = validateQuestionContent(parsed.data as QuestionContent)
    if (problems.length > 0) {
      setError(problems.join('; '))
      return
    }

    if (onSubmit) {
      onSubmit(parsed.data as QuestionContent)
      return
    }

    setSaving(true)
    try {
      await requestJson(
        '/api/questions',
        question
          ? jsonBody('PATCH', { id: question.id, question: parsed.data })
          : jsonBody('POST', { topicId, question: parsed.data }),
        t('library:questionEditor.saveFailed'),
      )
      onSaved()
    } catch (saveError) {
      setError(errorMessage(saveError, t('library:questionEditor.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <div className="w-56">
          <Label htmlFor={`question-editor-type-${uid}`}>{t('library:questionEditor.type')}</Label>
          <Select value={type} onValueChange={(next) => changeType(next as QuestionType)}>
            <SelectTrigger id={`question-editor-type-${uid}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.filter((option) => option !== 'label_image').map((value) => (
                <SelectItem key={value} value={value}>
                  {questionTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className={onSubmit ? 'hidden' : 'w-24'}>
          <Label htmlFor={`question-editor-points-${uid}`}>{t('library:questionEditor.points')}</Label>
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
          <Label htmlFor={`question-editor-difficulty-${uid}`}>{t('library:questionEditor.difficulty')}</Label>
          <Select
            value={String(difficulty)}
            onValueChange={(next) => setDifficulty(Number(next) as 1 | 2 | 3)}
          >
            <SelectTrigger id={`question-editor-difficulty-${uid}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t('library:questionEditor.difficultyEasy')}</SelectItem>
              <SelectItem value="2">{t('library:questionEditor.difficultyMedium')}</SelectItem>
              <SelectItem value="3">{t('library:questionEditor.difficultyHard')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4">
        <PayloadFields type={type} payload={payload} onChange={setPayload} />
      </div>

      <div className="mt-4">
        <Label htmlFor={`question-editor-explanation-${uid}`}>{t('library:questionEditor.explanation')}</Label>
        <Textarea
          id={`question-editor-explanation-${uid}`}
          value={explanation}
          placeholder={t('library:questionEditor.explanationPlaceholder')}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? t('common:actions.saving') : t('common:actions.save')}
        </Button>
      </div>
    </>
  )
}

/** Editor for one question in a dialog — hand-written or generated; all types in the same form. */
export function QuestionEditor({
  topicId,
  question,
  returnFocusRef,
  onClose,
  onSaved,
  onSubmit,
  title,
}: {
  topicId: string
  question: Question | null
  /**
   * The button focus should return to after the dialog closes. When the
   * editor opens from a row menu (the three dots), Radix would otherwise
   * return focus to `<body>` — the menu closes in the same tick the dialog
   * opens and so robs itself of its own focus return.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onClose: () => void
  onSaved: () => void
  /** See `QuestionEditorForm` — content without saving to the bank. */
  onSubmit?: (content: QuestionContent) => void
  /** Dialog title instead of the default „Upravit otázku“ / „Nová otázka“. */
  title?: string
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="max-h-[85vh] max-w-3xl overflow-y-auto"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title ?? (question ? t('library:questionEditor.editTitle') : t('library:questionEditor.newTitle'))}</DialogTitle>
        </DialogHeader>
        <QuestionEditorForm
          topicId={topicId}
          question={question}
          onCancel={onClose}
          onSaved={() => onSaved()}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
