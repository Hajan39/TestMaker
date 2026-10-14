'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  DropdownMenuItem,
  toast,
} from '@testmaker/ui'
import { PrintMenuItems } from '@/components/PrintMenu'
import { RowActions } from '@/components/RowActions'
import { errorMessage, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'
import type { TestKind } from '@testmaker/core/schema'
import { testPath } from './paths'
import { formatDate } from '@testmaker/core/dates'
import { KindMark } from '@/components/KindMark'

export interface TestRowData {
  id: string
  kind: TestKind
  title: string
  graded: boolean
  variants: number
  questionCount: number
  points: number
  templateName: string
  /** "Subject · grade"; `null` for a test without a grade. */
  gradeLabel: string | null
  /** Worksheet topic; `null` for a free-form brief (also when the topic has since disappeared). */
  topicName: string | null
  /** All items except page breaks — counted instead of questions for a worksheet. */
  itemCount: number
  /** Own test; one shared by a colleague can only be opened, printed and copied. */
  mine: boolean
  updatedAt: string
}

/**
 * Actions for one test: a menu behind three dots — the same pattern as for bank
 * questions. Delete is in it, in red and with confirmation; it cannot be hit by
 * accident.
 */
export function TestActions({ row }: { row: TestRowData }) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  // What is happening to the test right now. The menu closes on click, so the
  // state cannot show inside it — it replaces the three-dot button instead.
  const [pdfWork, setPdfWork] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)

  /** Rendering the PDF takes seconds; without this the click seemed to do nothing. */
  async function withPdfWork(label: string, work: () => Promise<void>) {
    setPdfError(null)
    setPdfWork(label)
    try {
      await work()
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : String(error))
    } finally {
      setPdfWork(null)
    }
  }

  /**
   * Copy of the test. The teacher wants to reuse last year's test, not
   * overwrite it — the copy takes the frozen question wording too, so it looks
   * exactly like the original even if the bank questions have changed since.
   */
  const copyMutation = useMutation({
    mutationFn: async () => {
      const failure = t('tests:row.copyFailed')
      const data = await requestJson<{ id: string }>(
        `/api/tests?copyOf=${encodeURIComponent(row.id)}`,
        { method: 'POST' },
        failure,
      )
      if (!data.id) throw new Error(`${failure} ${t('common:errors.serverTrouble')}`)
      return data.id
    },
    onSuccess: (id) => {
      router.refresh()
      toast.success(t('tests:row.copied', { title: row.title }), {
        duration: 10_000,
        testId: 'toast-test-copied',
        action: { label: t('common:actions.open'), onClick: () => router.push(testPath(row.kind, id)) },
      })
    },
    onError: (error) => toast.error(errorMessage(error, t('tests:row.copyFailed'))),
  })
  const copying = copyMutation.isPending

  const deleteFailure = row.kind === 'pracovni_list' ? t('worksheets:row.deleteFailed') : t('tests:row.deleteFailed')
  const removeMutation = useMutation({
    mutationFn: () => requestJson(`/api/tests?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }, deleteFailure),
    onSuccess: () => {
      // The dialog only closes on success — after an error it stays open for a retry.
      setConfirmOpen(false)
      toast.success(t('tests:row.deleted', { title: row.title }))
      router.refresh()
    },
    onError: (error) => toast.error(errorMessage(error, deleteFailure)),
  })
  const deleting = removeMutation.isPending

  return (
    <>
      <RowActions
        label={
          row.kind === 'pracovni_list'
            ? t('worksheets:row.actions', { title: row.title })
            : t('tests:row.actions', { title: row.title })
        }
        busy={pdfWork ?? (copying ? t('tests:row.copying') : null)}
      >
        <DropdownMenuItem asChild>
          <Link href={testPath(row.kind, row.id)}>{row.mine ? t('common:actions.edit') : t('common:actions.open')}</Link>
        </DropdownMenuItem>
        {/* The menu closes on click — copying shows in place of the
            three-dot button, just like printing. */}
        <DropdownMenuItem onSelect={() => copyMutation.mutate()}>{t('tests:row.copy')}</DropdownMenuItem>
        {/* Print and download take their labels from the shared menu — so the
            test list and the builder cannot disagree on what "Vytisknout"
            actually does with the answer key. */}
        <PrintMenuItems
          testId={row.id}
          variants={row.variants}
          onRun={(action) => void withPdfWork(action.busyLabel, action.run)}
        />
        {/* Only the author may delete — for a shared test the server would answer "not found". */}
        {row.mine ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault()
              setConfirmOpen(true)
            }}
          >
            {t('common:actions.delete')}
          </DropdownMenuItem>
        ) : null}
      </RowActions>
      {pdfError ? <p className="mt-1 text-sm text-danger">{pdfError}</p> : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {row.kind === 'pracovni_list'
                ? t('worksheets:row.deleteTitle', { title: row.title })
                : t('tests:row.deleteTitle', { title: row.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {row.kind === 'pracovni_list'
                ? t('worksheets:row.deleteHint')
                : t('tests:row.deleteHint')}{' '}
              {t('tests:row.irreversible')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              aria-busy={deleting || undefined}
              onClick={(event) => {
                event.preventDefault()
                removeMutation.mutate()
              }}
            >
              {deleting ? t('common:actions.deleting') : t('common:actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Test badges — only the exceptions: ungraded, variants A/B. Most tests are
 * graded, and a "na známky" badge on every row said nothing. A worksheet is
 * never graded — its badge says what it was made from.
 */
export function TestBadges({ row }: { row: TestRowData }) {
  if (row.kind === 'pracovni_list') {
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge variant="secondary">{row.topicName ? t('worksheets:row.topic', { topic: row.topicName }) : t('worksheets:row.freeBrief')}</Badge>
      </div>
    )
  }
  if (row.graded && row.variants !== 2) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {row.graded ? null : <Badge variant="secondary">{t('tests:row.ungraded')}</Badge>}
      {row.variants === 2 ? <Badge variant="secondary">{t('tests:row.variantsAB')}</Badge> : null}
    </div>
  )
}

/**
 * The same test as a card — the phone layout. In a table at 390 px the points
 * column and the whole action menu would sit off screen and nothing could be
 * done with the test at all.
 */
export function TestCard({ row }: { row: TestRowData }) {
  return (
    <li
      className={
        'rounded-[var(--radius-inner)] border border-line-soft p-3 ' +
        (row.kind === 'pracovni_list' ? 'border-l-2 border-l-worksheet' : '')
      }
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={testPath(row.kind, row.id)}
            className="font-medium break-words text-fg hover:text-brand"
          >
            <KindMark kind={row.kind} className="mr-1.5 align-[-0.125em]" />
            {row.title}
          </Link>
          <TestBadges row={row} />
        </div>
        <TestActions row={row} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-fg-soft">
        {row.kind === 'pracovni_list' ? (
          <span className="ui-numeric">{t('common:items', { count: row.itemCount })}</span>
        ) : (
          <>
            <span className="ui-numeric">{t('tests:row.questions', { count: row.questionCount })}</span>
            <span aria-hidden="true">·</span>
            <span className="ui-numeric">{t('tests:row.points', { points: row.points })}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>{row.templateName}</span>
        {row.gradeLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{row.gradeLabel}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span className="text-fg-muted">{formatDate(row.updatedAt)}</span>
      </p>
    </li>
  )
}
