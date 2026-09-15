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

  // Refy drží čerstvé hodnoty pro posluchač klávesnice (registruje se jen
  // jednou) a pro přepočet pozice po změně seznamu zvenku.
  const questionsRef = useRef(questions)
  questionsRef.current = questions
  const indexRef = useRef(0)
  const currentIdRef = useRef<string | undefined>(questions[0]?.id)
  const handlers = useRef({ onApprove, onReject, onEdit, onClose })
  handlers.current = { onApprove, onReject, onEdit, onClose }
  const isFirstRun = useRef(true)

  function goTo(nextIndex: number) {
    const list = questionsRef.current
    if (nextIndex >= list.length) {
      handlers.current.onClose()
      return
    }
    indexRef.current = nextIndex
    currentIdRef.current = list[nextIndex]?.id
    setIndex(nextIndex)
  }

  // Seznam pod frontou je živý a profiltrovaný — jakmile z něj zvenku (po
  // schválení/zamítnutí a obnovení stránky) zmizí otázka, přepočítá se
  // pozice podle id otázky, na které fronta stála, ne podle čísla indexu,
  // které by po zkrácení pole mohlo mířit za konec nebo přeskočit sousední
  // otázku. Když otázka, na které fronta stála, zmizela, zůstane na stejné
  // pozici, kterou teď zaujímá další otázka v pořadí; frontu zavře, teprve
  // když nezbývá nic.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    if (questions.length === 0) {
      handlers.current.onClose()
      return
    }
    const stillThere = currentIdRef.current
      ? questions.findIndex((question) => question.id === currentIdRef.current)
      : -1
    const nextIndex = stillThere !== -1 ? stillThere : Math.min(indexRef.current, questions.length - 1)
    indexRef.current = nextIndex
    currentIdRef.current = questions[nextIndex]?.id
    setIndex(nextIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Escape zavírá frontu vždy — i když má ohnisko textové pole (dialog
      // se má dát zavřít i uprostřed psaní).
      if (event.key === 'Escape') {
        handlers.current.onClose()
        return
      }
      // Ostatní (akční) klávesy se v textových polích ignorují, aby psaní
      // vlastní otázky neschvalovalo/nezamítalo koncepty.
      if (isTypingTarget(event.target)) return

      const active = questionsRef.current[indexRef.current]
      if (!active) return
      if (event.key === 'a' || event.key === 'A') {
        handlers.current.onApprove(active.id)
        goTo(indexRef.current + 1)
      } else if (event.key === 'x' || event.key === 'X') {
        handlers.current.onReject(active.id)
        goTo(indexRef.current + 1)
      } else if (event.key === 'e' || event.key === 'E') {
        handlers.current.onEdit(active.id)
      } else if (event.key === 'ArrowRight') {
        goTo(indexRef.current + 1)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const current = questions[index]
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
            goTo(indexRef.current + 1)
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
            goTo(indexRef.current + 1)
          }}
        >
          Zamítnout <span className="ml-1 text-xs opacity-70">(X)</span>
        </Button>
        <Button variant="ghost" onClick={() => goTo(indexRef.current + 1)}>
          Přeskočit <span className="ml-1 text-xs opacity-70">(→)</span>
        </Button>
      </div>
    </div>
  )
}
