'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  toast,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { createTestVariantStream, type TestVariantDirection, type TestVariantEvent } from '@/lib/generateClient'

/**
 * Creates an easier or harder version of the whole saved test — a menu in the
 * builder header, next to printing.
 *
 * The version is always made from what is saved, not from unsaved edits in the
 * editor: `onDirty` is called instead of the request when the test has unsaved
 * changes, and the builder responds with its own message (saving is manual).
 */
export function TestVariantMenu({
  testId,
  ai,
  dirty,
  onDirty,
}: {
  testId: string
  /** Generation status from the page — without a model the menu just explains why. */
  ai: { configured: boolean; problems: string[] }
  dirty: boolean
  /** Called when the test has unsaved changes — a version can only be made after saving. */
  onDirty: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<TestVariantDirection | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // The server finishes the version even after the page closes, but the teacher
  // would not learn the outcome — so leaving during creation asks first.
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  async function run(direction: TestVariantDirection) {
    if (dirty) {
      onDirty()
      return
    }
    setBusy(direction)
    setProgress(null)
    // The copy id arrives right in the `start` event. If the run fails before
    // `done` (the server kills the function at its limit, the network drops),
    // the copy already exists and would be orphaned — so the teacher is
    // redirected to it with a warning.
    const end: { copy?: string; done?: TestVariantEvent & { type: 'done' }; error?: string } = {}
    const openPartial = (copy: string) => {
      // Longer than a regular toast: redirecting to the copy takes a while and the
      // warning must not vanish before the copy page even shows.
      toast.warning(t('tests:variant.partial'), { duration: 15_000 })
      router.push(`/tests/${copy}`)
    }
    try {
      await createTestVariantStream(testId, direction, (event) => {
        if (event.type === 'start') {
          end.copy = event.testId
          setProgress({ done: 0, total: event.total })
        } else if (event.type === 'progress') setProgress({ done: event.done, total: event.total })
        else if (event.type === 'done') end.done = event
        else if (event.type === 'error') end.error = event.message
      })

      if (end.error) {
        toast.error(end.error)
        if (end.copy) openPartial(end.copy)
        return
      }
      const done = end.done
      if (!done) {
        if (end.copy) openPartial(end.copy)
        else toast.error(t('tests:variant.failed'))
        return
      }

      // Summary: what came from existing versions, what was newly generated and
      // how many questions stayed as they were — the last is the most important
      // finding for the teacher, so it gets its own sentence, not just a number.
      const createdDetail = [
        done.replaced > 0 ? t('tests:variant.replaced', { count: done.replaced }) : null,
        done.generated > 0 ? t('tests:variant.generated', { count: done.generated }) : null,
      ]
        .filter((cast): cast is string => Boolean(cast))
        .join(', ')
      toast.success(
        (direction === 'easier' ? t('tests:variant.doneEasier') : t('tests:variant.doneHarder')) +
          (createdDetail ? ` ${createdDetail}.` : ''),
      )
      if (done.kept > 0) {
        // Czech has three plural forms for counts: "1 otázka zůstala původní",
        // "3 otázky zůstaly původní", "5 otázek zůstalo původních".
        toast.message(t('tests:variant.kept', { count: done.kept }))
      }
      router.push(`/tests/${done.testId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('tests:variant.failed'))
      if (end.copy && !end.done) openPartial(end.copy)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy !== null} aria-busy={busy !== null || undefined}>
          {busy
            ? progress
              ? t('tests:variant.progress', { done: progress.done, total: progress.total })
              : t('tests:variant.preparing')
            : t('tests:variant.menu')}
          {!busy ? <ChevronDown className="size-3.5" /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={ai.configured ? undefined : 'max-w-xs'}>
        {/* Without a model no version can be made (new questions are generated
            too), so say why up front instead of failing midway. */}
        {!ai.configured ? (
          <DropdownMenuLabel className="text-xs font-normal text-fg-soft">
            {t('tests:variant.notConfigured')}
            {ai.problems.length > 0 ? ` ${ai.problems.join(' ')}` : ` ${t('tests:variant.askAdmin')}`}
          </DropdownMenuLabel>
        ) : null}
        {(['easier', 'harder'] as const).map((direction) => (
          <DropdownMenuItem key={direction} disabled={!ai.configured} onSelect={() => void run(direction)}>
            {direction === 'easier' ? t('tests:variant.easier') : t('tests:variant.harder')}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
