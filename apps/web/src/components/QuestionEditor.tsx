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
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { PayloadFields } from './PayloadFields'

/**
 * Co opravit, podle pole, které zod odmítl. Anglická hláška zodu s cestou
 * typu „payload.options.1: String must contain…“ učitelce nic neřekne.
 */
const FIELD_PROBLEMS: Record<string, string> = {
  prompt: 'Zadání je moc krátké — napiš aspoň pár slov.',
  options: 'Doplň možnosti odpovědí: žádná nesmí zůstat prázdná a musí jich být dost (u jedné správné aspoň 2, u více správných aspoň 3).',
  correctIndex: 'Označ správnou odpověď.',
  correctIndices: 'Označ aspoň jednu správnou odpověď.',
  answer: 'Vyplň správnou odpověď do klíče.',
  acceptedAnswers: 'Další přípustné odpovědi nesmějí být prázdné (nejvýš 10).',
  statements: 'Každé tvrzení musí mít aspoň pár písmen; tvrzení může být nejvýš 12.',
  text: 'Napiš text s místy k doplnění a označ je třemi podtržítky ___.',
  blanks: 'Ke každému místu ___ doplň správný výraz.',
  wordBank: 'Slova v nabídce nesmějí být prázdná (nejvýš 30).',
  left: 'Vyplň obě strany dvojic — aspoň dvě položky vlevo i vpravo, žádná prázdná.',
  right: 'Vyplň obě strany dvojic — aspoň dvě položky vlevo i vpravo, žádná prázdná.',
  pairs: 'Přiřaď k sobě aspoň dvě dvojice.',
  items: 'Vyplň aspoň tři položky k seřazení, žádná nesmí zůstat prázdná.',
  headers: 'Doplň záhlaví tabulky.',
  rows: 'Tabulka musí mít aspoň jeden řádek.',
  answers: 'Doplň správné odpovědi do prázdných buněk tabulky.',
  lines: 'Počet řádků na odpověď je moc velký — zvol menší číslo.',
  points: 'Body musí být číslo od 0 do 100.',
  explanation: 'Poznámka do klíče je moc dlouhá — zkrať ji pod 1000 znaků.',
}

function describeIssues(paths: PropertyKey[][]): string {
  const messages = new Set(
    paths.map((path) => {
      // `payload.options.1` → `options`, `points` → `points`.
      const field = String(path[0] === 'payload' ? path[1] : path[0])
      return FIELD_PROBLEMS[field] ?? 'Otázka není vyplněná celá. Zkontroluj zadání, odpovědi a správné řešení.'
    }),
  )
  return [...messages].join(' ')
}

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
  onSubmit,
}: {
  topicId: string
  question: Question | null
  onCancel: () => void
  onSaved: (saved?: Question) => void
  /**
   * Místo uložení do banky předá obsah volajícímu — úloha pracovního listu
   * žije jen ve snímku položky listu, do banky nepatří. Body se pak nenabízejí,
   * list se neznámkuje.
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
        'Otázku se nepodařilo uložit.',
      )
      onSaved()
    } catch (saveError) {
      setError(errorMessage(saveError, 'Otázku se nepodařilo uložit.'))
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
        <div className={onSubmit ? 'hidden' : 'w-24'}>
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
  returnFocusRef,
  onClose,
  onSaved,
  onSubmit,
  title,
}: {
  topicId: string
  question: Question | null
  /**
   * Tlačítko, na které se má vrátit ohnisko po zavření dialogu. Otevírá-li
   * se editor z nabídky u řádku (třemi tečkami), Radix bez tohohle vrátí
   * ohnisko na `<body>` — nabídka se zavírá ve stejném tiku, ve kterém se
   * dialog otevírá, a okrade tak sama sebe o svůj vlastní návrat ohniska.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onClose: () => void
  onSaved: () => void
  /** Viz `QuestionEditorForm` — obsah bez uložení do banky. */
  onSubmit?: (content: QuestionContent) => void
  /** Nadpis dialogu místo výchozího „Upravit otázku“ / „Nová otázka“. */
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
          <DialogTitle>{title ?? (question ? 'Upravit otázku' : 'Nová otázka')}</DialogTitle>
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
