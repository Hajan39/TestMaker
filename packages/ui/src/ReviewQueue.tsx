'use client'

import { useEffect, useRef, useState } from 'react'
import type { Question } from '@testmaker/core/schema'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import { QuestionPreview } from './QuestionPreview'

/** Zjistí, jestli má stisk klávesy zamířit do textového pole, ne do fronty. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/**
 * Soustředěná fronta ke schvalování konceptů — jedna otázka po druhé,
 * ovládaná klávesami. Bez závislosti na Next.js nebo fetchi.
 */
export function ReviewQueue({
  questions,
  onApprove,
  onReject,
  onEdit,
  onClose,
}: {
  questions: Question[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit: (id: string) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const current = questions[index]

  // Callbacky drženy v ref, aby se posluchač klávesnice nemusel při každé
  // změně otázky odregistrovat a znovu registrovat.
  const handlers = useRef({ onApprove, onReject, onEdit, onClose })
  handlers.current = { onApprove, onReject, onEdit, onClose }

  function advance() {
    setIndex((i) => {
      const next = i + 1
      if (next >= questions.length) {
        handlers.current.onClose()
        return i
      }
      return next
    })
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return
      if (event.key === 'Escape') {
        handlers.current.onClose()
        return
      }
      const active = questions[index]
      if (!active) return
      if (event.key === 'a' || event.key === 'A') {
        handlers.current.onApprove(active.id)
        advance()
      } else if (event.key === 'x' || event.key === 'X') {
        handlers.current.onReject(active.id)
        advance()
      } else if (event.key === 'e' || event.key === 'E') {
        handlers.current.onEdit(active.id)
      } else if (event.key === 'ArrowRight') {
        advance()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, questions])

  if (!current) {
    return <p className="text-sm text-fg-muted">Žádné otázky k projití.</p>
  }

  const progress = questions.length === 0 ? 0 : ((index + 1) / questions.length) * 100

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="ui-label text-fg-muted">
            {index + 1} z {questions.length}
          </span>
        </div>
        <Progress value={progress} />
      </div>

      <div className="rounded-[var(--radius-inner)] border border-line p-4">
        <QuestionPreview question={current} />
      </div>

      {current.evidence ? (
        <div className="rounded-[var(--radius-inner)] border border-line-soft bg-surface-muted p-3 text-sm">
          <p className="ui-label text-fg-muted">Doklad původu</p>
          <p className="mt-1 text-fg-soft">„{current.evidence.quote}“</p>
          <p className="mt-1 text-xs text-fg-muted">{current.evidence.fileName}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            onApprove(current.id)
            advance()
          }}
        >
          Schválit <span className="ml-1 text-xs opacity-70">(A)</span>
        </Button>
        <Button variant="outline" onClick={() => onEdit(current.id)}>
          Upravit <span className="ml-1 text-xs opacity-70">(E)</span>
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            onReject(current.id)
            advance()
          }}
        >
          Zamítnout <span className="ml-1 text-xs opacity-70">(X)</span>
        </Button>
        <Button variant="ghost" onClick={() => advance()}>
          Přeskočit <span className="ml-1 text-xs opacity-70">(→)</span>
        </Button>
      </div>
    </div>
  )
}
