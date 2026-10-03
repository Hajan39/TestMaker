'use client'

import { useId } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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

/**
 * The form's shape. The content rules stay in core: the transform runs the
 * same `questionContentSchema` and `validateQuestionContent` as the server and
 * reports what to fix under `payload`. Built per call so messages follow the language.
 */
function formSchema(blocks: Question['blocks']) {
  return z
    .object({
      type: z.enum(QUESTION_TYPES),
      payload: z.record(z.string(), z.unknown()),
      points: z.number(),
      difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      explanation: z.string(),
    })
    .transform((value, ctx): QuestionContent => {
      const fail = (message: string) => {
        ctx.addIssue({ code: 'custom', path: ['payload'], message })
        return z.NEVER
      }
      const parsed = questionContentSchema.safeParse({
        ...value,
        explanation: value.explanation.trim() || undefined,
        blocks,
      })
      if (!parsed.success) return fail(describeIssues(parsed.error.issues.map((issue) => issue.path)))
      const problems = validateQuestionContent(parsed.data as QuestionContent)
      if (problems.length > 0) return fail(problems.join('; '))
      return parsed.data as QuestionContent
    })
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
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<ReturnType<typeof formSchema>>, unknown, QuestionContent>({
    resolver: zodResolver(formSchema(question?.blocks ?? [])),
    defaultValues: {
      type: question?.type ?? 'single_choice',
      payload: question ? (question.payload as Record<string, unknown>) : emptyPayload('single_choice'),
      points: question?.points ?? DEFAULT_POINTS.single_choice,
      difficulty: question?.difficulty ?? 2,
      explanation: question?.explanation ?? '',
    },
  })
  const type = useWatch({ control, name: 'type' })
  const difficulty = useWatch({ control, name: 'difficulty' })
  // One message under the form: what is wrong with the content, or what the server said.
  const error = (errors.payload?.message as string | undefined) ?? errors.root?.message ?? null
  // A card being edited and „Nová otázka" can be on screen side by side —
  // fixed ids would then repeat and `htmlFor` would point at another field.
  const uid = useId()

  function changeType(next: QuestionType) {
    setValue('type', next)
    setValue('payload', emptyPayload(next))
    setValue('points', DEFAULT_POINTS[next])
  }

  async function save(content: QuestionContent) {
    if (onSubmit) {
      onSubmit(content)
      return
    }
    try {
      await requestJson(
        '/api/questions',
        question
          ? jsonBody('PATCH', { id: question.id, question: content })
          : jsonBody('POST', { topicId, question: content }),
        t('library:questionEditor.saveFailed'),
      )
      onSaved()
    } catch (saveError) {
      setError('root', { message: errorMessage(saveError, t('library:questionEditor.saveFailed')) })
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
            defaultValue={question?.points ?? DEFAULT_POINTS.single_choice}
            {...register('points', { setValueAs: (value) => Number(value) || 0 })}
          />
        </div>
        <div className="w-36">
          <Label htmlFor={`question-editor-difficulty-${uid}`}>{t('library:questionEditor.difficulty')}</Label>
          <Select
            value={String(difficulty)}
            onValueChange={(next) => setValue('difficulty', Number(next) as 1 | 2 | 3)}
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
        <Controller
          control={control}
          name="payload"
          render={({ field }) => <PayloadFields type={type} payload={field.value} onChange={field.onChange} />}
        />
      </div>

      <div className="mt-4">
        <Label htmlFor={`question-editor-explanation-${uid}`}>{t('library:questionEditor.explanation')}</Label>
        <Textarea
          id={`question-editor-explanation-${uid}`}
          defaultValue={question?.explanation ?? ''}
          placeholder={t('library:questionEditor.explanationPlaceholder')}
          {...register('explanation')}
        />
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button disabled={isSubmitting} onClick={() => void handleSubmit(save)()}>
          {isSubmitting ? t('common:actions.saving') : t('common:actions.save')}
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
