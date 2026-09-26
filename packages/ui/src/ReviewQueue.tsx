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
 *
 * `questions` nemusí být celá fronta: obrazovka kontroly nad celou knihovnou
 * jich drží jen okno a další si dotahuje. Proto je tu `overall` (kolik je
 * zkontrolováno a kolik zbývá dohromady) a `onPosition` (kde ve svém okně fronta
 * právě stojí, aby volající věděl, kdy načíst další stránku).
 */
export function ReviewQueue({
  questions,
  onApprove,
  onReject,
  onEdit,
  onClose,
  onRegenerate,
  onPosition,
  overall,
  busy = false,
}: {
  questions: Question[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit: (id: string) => void
  onClose: () => void
  /** Nechat modelem vyrobit náhradu téže otázky. Bez toho se tlačítko nekreslí. */
  onRegenerate?: (id: string) => void
  /** Kolikátá otázka okna je právě na řadě. */
  onPosition?: (index: number, id: string) => void
  /** Postup napříč celou frontou, ne jen načteným oknem. */
  overall?: { approved: number; remaining: number }
  /** Něco právě běží (typicky náhrada modelem) — akce se na tu chvíli zamknou. */
  busy?: boolean
}) {
  const [index, setIndex] = useState(0)

  // Refy drží čerstvé hodnoty pro posluchač klávesnice (registruje se jen
  // jednou) a pro přepočet pozice po změně seznamu zvenku.
  const questionsRef = useRef(questions)
  questionsRef.current = questions
  const indexRef = useRef(0)
  const currentIdRef = useRef<string | undefined>(questions[0]?.id)
  const handlers = useRef({ onApprove, onReject, onEdit, onClose, onRegenerate })
  handlers.current = { onApprove, onReject, onEdit, onClose, onRegenerate }
  const busyRef = useRef(busy)
  busyRef.current = busy
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
      } else if ((event.key === 'n' || event.key === 'N') && handlers.current.onRegenerate) {
        // Náhrada trvá; druhý stisk během čekání by jich rozjel několik naráz.
        if (!busyRef.current) handlers.current.onRegenerate(active.id)
      } else if (event.key === 'ArrowRight') {
        goTo(indexRef.current + 1)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Kde fronta stojí ve svém okně — volající podle toho dotahuje další stránku
  // dřív, než na konec okna dojede.
  const currentId = questions[index]?.id
  useEffect(() => {
    if (currentId) onPosition?.(index, currentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, currentId])

  const current = questions[index]
  if (!current) {
    return <p className="text-sm text-fg-muted">Žádné otázky k projití.</p>
  }

  // Bez `overall` se ukazuje postup v načteném seznamu; s ním postup celou
  // frontou, která může být mnohonásobně delší než okno v paměti.
  const total = overall ? overall.approved + overall.remaining : questions.length
  const done = overall ? overall.approved : index + 1
  const progress = total === 0 ? 0 : (done / total) * 100

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="ui-label text-fg-muted">
            {/* Jedno sloveso a jeden směr pro celé rozhraní: kolik zbývá.
                Bez „z kolika“ — zamítnutá otázka z fronty odejde, takže by
                se jmenovatel pod rukama zmenšoval. Kolik už je odbaveno,
                ukazuje pruh pod popiskem. */}
            {overall
              ? `Zbývá ke kontrole ${overall.remaining}`
              : `Zbývá ke kontrole ${questions.length - index}`}
          </span>
        </div>
        <Progress value={progress} />
      </div>

      <div className="rounded-[var(--radius-inner)] border border-line p-4">
        <QuestionPreview question={current} showStatus />
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
          disabled={busy}
          onClick={() => {
            onApprove(current.id)
            goTo(indexRef.current + 1)
          }}
        >
          Schválit <span className="ml-1 text-xs opacity-70">(A)</span>
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onEdit(current.id)}>
          Upravit <span className="ml-1 text-xs opacity-70">(E)</span>
        </Button>
        {onRegenerate ? (
          <Button variant="outline" disabled={busy} onClick={() => onRegenerate(current.id)}>
            {busy ? 'Nahrazuji…' : 'Nahradit modelem'} <span className="ml-1 text-xs opacity-70">(N)</span>
          </Button>
        ) : null}
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            onReject(current.id)
            goTo(indexRef.current + 1)
          }}
        >
          Zamítnout <span className="ml-1 text-xs opacity-70">(X)</span>
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => goTo(indexRef.current + 1)}>
          Přeskočit <span className="ml-1 text-xs opacity-70">(→)</span>
        </Button>
      </div>
    </div>
  )
}
