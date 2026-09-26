'use client'

import Link from 'next/link'
import type { Question } from '@testmaker/core/schema'
import { Button, Checkbox, QuestionPreview } from '@testmaker/ui'
import { QuestionEditorForm } from '@/components/QuestionEditor'
import { RegenerateButton } from '@/components/RegenerateButton'
import type { TestUsage } from '@/components/TopicQuestions'

/**
 * Jedna karta otázky v tématu: náhled se zaškrtávátkem do testu a akcemi
 * (úprava, přegenerování, smazání), nebo rozpracovaná úprava místo nich.
 *
 * Vytažené z `TopicQuestions`, aby soubor se seznamem a filtry nenarostl přes
 * rozumnou délku — stav (výběr, editace, mazání) zůstává o patro výš, karta
 * je jen jeho zobrazení.
 */
export function QuestionCard({
  topicId,
  question,
  editing,
  muzeMenit,
  selected,
  busy,
  usage,
  onEditStart,
  onEditCancel,
  onEditSaved,
  onToggleSelect,
  onRegenerateDone,
  onRemove,
  deleted,
  restoring,
  onRestore,
}: {
  topicId: string
  question: Question
  editing: boolean
  muzeMenit: boolean
  /** Zaškrtnutá do rozpracovaného testu — jen pro `muzeMenit`. */
  selected: boolean
  /** Právě se maže — chrání proti dvojímu kliknutí na „Smazat". */
  busy: boolean
  /** Testy, ve kterých otázka už je — jen ty viditelné volající. */
  usage: TestUsage[] | undefined
  onEditStart: () => void
  onEditCancel: () => void
  onEditSaved: () => void
  onToggleSelect: () => void
  onRegenerateDone: () => void
  onRemove: () => void
  /**
   * Karta ze seznamu „Smazané" — tlumená podoba s jediným tlačítkem
   * „Obnovit" místo úprav, přegenerování a mazání.
   */
  deleted?: boolean
  /** Právě probíhá obnovení — chrání proti dvojímu kliknutí na „Obnovit". */
  restoring?: boolean
  onRestore?: () => void
}) {
  if (deleted) {
    return (
      <div className="flex gap-3 opacity-60">
        <div className="min-w-0 flex-1">
          <QuestionPreview question={question} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button size="sm" variant="ghost" disabled={restoring} onClick={onRestore}>
            Obnovit
          </Button>
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <QuestionEditorForm
        topicId={topicId}
        question={question}
        onCancel={onEditCancel}
        onSaved={onEditSaved}
      />
    )
  }

  return (
    <div className="flex gap-3">
      {muzeMenit ? (
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label="Vybrat do testu"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <QuestionPreview question={question} />
        <TestUsageLabel usage={usage} />
      </div>
      {muzeMenit ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button size="sm" variant="ghost" onClick={onEditStart}>
            Upravit
          </Button>
          <RegenerateButton questionId={question.id} type={question.type} onDone={onRegenerateDone} />
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            disabled={busy}
            onClick={onRemove}
          >
            Smazat
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Drobný štítek „V testu: Název" pod náhledem otázky. Testy, na které
 * volající nevidí (cizí soukromý test kolegyně), sem `usage` vůbec nedostane
 * — štítek proto nikdy neprozradí, že takový test existuje.
 */
function TestUsageLabel({ usage }: { usage: TestUsage[] | undefined }) {
  if (!usage || usage.length === 0) return null
  const [prvni, ...zbytek] = usage
  return (
    <p className="mt-1 text-xs text-fg-muted">
      V testu:{' '}
      <Link href={`/tests/${prvni!.testId}`} className="hover:text-brand hover:underline">
        {prvni!.title}
      </Link>
      {zbytek.length > 0 ? ` a další ${zbytek.length}` : ''}
    </p>
  )
}
