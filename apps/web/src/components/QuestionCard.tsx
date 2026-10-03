'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Question } from '@testmaker/core/schema'
import { Button, Checkbox, QuestionPreview } from '@testmaker/ui'
import { QuestionEditorForm } from '@/components/QuestionEditor'
import { RegenerateButton } from '@/components/RegenerateButton'
import type { TestUsage } from '@/components/TopicQuestions'
import { t } from '@testmaker/core/i18n'

/**
 * One question card in a topic: a preview with a checkbox for the test and
 * actions (edit, regenerate, delete), or the editor in their place.
 *
 * Extracted from `TopicQuestions` so the file with the list and filters does
 * not grow past a reasonable length — state (selection, editing, deleting)
 * stays one level up, the card only renders it.
 */
export function QuestionCard({
  topicId,
  question,
  editing,
  canEdit,
  selected,
  busy,
  usage,
  versions,
  onEditStart,
  onEditCancel,
  onEditSaved,
  onToggleSelect,
  onRegenerateDone,
  onVariantCreated,
  onJumpToVersion,
  onRemove,
  deleted,
  restoring,
  onRestore,
}: {
  topicId: string
  question: Question
  editing: boolean
  canEdit: boolean
  /** Checked for the test being built — only for `canEdit`. */
  selected: boolean
  /** Being deleted right now — guards against a double click on „Smazat". */
  busy: boolean
  /** Tests that already contain the question — only those visible to the caller. */
  usage: TestUsage[] | undefined
  /**
   * Easier and harder versions of the root the question belongs to (or is
   * itself) — for the „Verze: …" row. Empty when the question has no versions.
   * `nahled` sees it too, just not version creation.
   */
  versions: { id: string; direction: 'easier' | 'harder' }[]
  onEditStart: () => void
  onEditCancel: () => void
  onEditSaved: () => void
  onToggleSelect: () => void
  onRegenerateDone: () => void
  onVariantCreated: (question: Question) => void
  onJumpToVersion: (id: string) => void
  onRemove: () => void
  /**
   * A card from the „Smazané" list — a muted look with a single „Obnovit"
   * button instead of edit, regenerate and delete.
   */
  deleted?: boolean
  /** Restoring right now — guards against a double click on „Obnovit". */
  restoring?: boolean
  onRestore?: () => void
}) {
  // While the model replaces the question or makes a version of it, editing
  // and deleting make no sense — after the replacement they would target a
  // question that is already rejected.
  const [aiBusy, setAiBusy] = useState(false)
  if (deleted) {
    return (
      <div className="flex gap-3 opacity-60">
        <div className="min-w-0 flex-1">
          <QuestionPreview question={question} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button size="sm" variant="ghost" disabled={restoring} onClick={onRestore}>
            {t('library:questionCard.restore')}
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
      {canEdit ? (
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={t('library:questionCard.selectForTest')}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <QuestionPreview question={question} />
        <TestUsageLabel usage={usage} />
        <VersionsLabel versions={versions} onJump={onJumpToVersion} />
      </div>
      {canEdit ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button size="sm" variant="ghost" disabled={aiBusy} onClick={onEditStart}>
            {t('common:actions.edit')}
          </Button>
          <RegenerateButton
            questionId={question.id}
            type={question.type}
            difficulty={question.difficulty}
            onDone={onRegenerateDone}
            onVariantCreated={onVariantCreated}
            onBusyChange={setAiBusy}
          />
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            disabled={busy || aiBusy}
            onClick={onRemove}
          >
            {t('common:actions.delete')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Small „V testu: Název" badge below the question preview. Tests the caller
 * cannot see (a colleague's private test) never reach `usage` — so the badge
 * never reveals that such a test exists.
 */
function TestUsageLabel({ usage }: { usage: TestUsage[] | undefined }) {
  if (!usage || usage.length === 0) return null
  const [first, ...rest] = usage
  return (
    <p className="mt-1 text-xs text-fg-muted" data-testid="question-in-test">
      {t('library:questionCard.inTest')}{' '}
      <Link href={`/tests/${first!.testId}`} className="hover:text-brand hover:underline">
        {first!.title}
      </Link>
      {rest.length > 0 ? ` ${t('library:questionCard.andMore', { count: rest.length })}` : ''}
    </p>
  )
}

/**
 * Small „Verze: lehčí · těžší" row below the question preview — on the root's
 * card and on the card of any of its versions. The links do not leave the
 * page (a version is a card in the same list), they just scroll to it and
 * briefly highlight it (`onJump`).
 *
 * Visible for `nahled` too — unlike the buttons that create a version, this
 * row only shows what already exists.
 */
function VersionsLabel({
  versions,
  onJump,
}: {
  versions: { id: string; direction: 'easier' | 'harder' }[]
  onJump: (id: string) => void
}) {
  if (versions.length === 0) return null
  return (
    <p className="mt-1 text-xs text-fg-muted">
      {t('library:questionCard.versions')}{' '}
      {versions.map((version, index) => (
        <span key={version.id}>
          {index > 0 ? ' · ' : ''}
          <button
            type="button"
            className="hover:text-brand hover:underline"
            onClick={() => onJump(version.id)}
          >
            {version.direction === 'easier' ? t('library:questionCard.easier') : t('library:questionCard.harder')}
          </button>
        </span>
      ))}
    </p>
  )
}
