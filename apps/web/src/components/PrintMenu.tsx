'use client'

import { Fragment, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  downloadPdf,
  printPdf,
  toast,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { useMutation } from '@tanstack/react-query'
import { errorMessage } from '@/lib/requestJson'
import { ShareLinkDialog, requestShareLink } from '@/components/ShareLinkDialog'

/**
 * Printing and downloading a test in one place.
 *
 * "Vytisknout" in the builder and "Vytisknout" in the test list used to behave
 * differently: the builder attached the answer key (the "Přiložit klíč" setting
 * was on by default), the list never did. The teacher could not tell from the
 * label what would come out of the printer — and at worst handed the solutions
 * to the pupils.
 *
 * So there are only two actions, named after who the paper is for:
 * **Zadání pro žáky** (blank) and **Vyplněná pro mě** (the same paper with the
 * correct answers written in red — easier to grade against than a separate
 * key list; `key=1` still renders the old key page for API callers). Both can be
 * printed or downloaded, for variant A and B. Both places in the app take this
 * list from here so their labels cannot drift apart again.
 */

/** One menu item: what happens, what it is called and what to show while waiting. */
export interface PrintAction {
  key: string
  label: string
  busyLabel: string
  run: () => Promise<void>
}

/** PDF render URL; `filled=1` writes the correct answers into the test. */
function pdfHref(testId: string, variant: 'A' | 'B', filled: boolean): string {
  return `/api/tests/${testId}/pdf?variant=${variant}${filled ? '&filled=1' : ''}`
}

/**
 * Actions grouped by variant. With a single variant the variant is left out of
 * the labels (nothing to choose from); with two it is included so every label
 * is unambiguous.
 */
export function printGroups(testId: string, variants: number): { variant: 'A' | 'B'; actions: PrintAction[] }[] {
  const list: ('A' | 'B')[] = variants === 2 ? ['A', 'B'] : ['A']
  return list.map((variant) => {
    const suffix = variants === 2 ? t('tests:print.variantSuffix', { variant }) : ''
    return {
      variant,
      actions: [
        {
          key: `print-zadani-${variant}`,
          label: t('tests:print.printStudents', { suffix }),
          busyLabel: t('tests:print.preparingPrint'),
          run: () => printPdf(pdfHref(testId, variant, false)),
        },
        {
          key: `print-vyplnena-${variant}`,
          label: t('tests:print.printFilled', { suffix }),
          busyLabel: t('tests:print.preparingPrint'),
          run: () => printPdf(pdfHref(testId, variant, true)),
        },
        {
          key: `pdf-zadani-${variant}`,
          label: t('tests:print.downloadStudents', { suffix }),
          busyLabel: t('tests:print.preparingPdf'),
          run: () => downloadPdf(pdfHref(testId, variant, false)),
        },
        {
          key: `pdf-vyplnena-${variant}`,
          label: t('tests:print.downloadFilled', { suffix }),
          busyLabel: t('tests:print.preparingPdf'),
          run: () => downloadPdf(pdfHref(testId, variant, true)),
        },
      ],
    }
  })
}

/**
 * Items for an existing dropdown (the test list has Edit and Delete in the
 * same menu). The caller handles waiting and errors — it knows where they fit
 * in its layout.
 */
export function PrintMenuItems({
  testId,
  variants,
  disabled = false,
  onRun,
}: {
  testId: string
  variants: number
  disabled?: boolean
  onRun: (action: PrintAction) => void
}) {
  const groups = printGroups(testId, variants)
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.variant}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.actions.map((action) => (
            <DropdownMenuItem key={action.key} disabled={disabled} onSelect={() => onRun(action)}>
              {action.label}
            </DropdownMenuItem>
          ))}
        </Fragment>
      ))}
    </>
  )
}

/**
 * Standalone menu for the builder bar — including waiting and the error message.
 *
 * The PDF is rendered on the server from the saved state. With unsaved changes
 * an older version than the one the teacher sees would print — so the menu
 * saves first (`ensureSaved`) and prints what was just saved.
 */
export function PrintMenu({
  testId,
  variants,
  unsaved = false,
  ensureSaved,
  share,
}: {
  /** `null` for a test that was never saved. */
  testId: string | null
  variants: number
  /** Unsaved changes (or a never-saved test) — they are saved before printing. */
  unsaved?: boolean
  /** Saves the test and resolves to its id; `null` when saving failed (the caller shows why). */
  ensureSaved?: () => Promise<string | null>
  /**
   * Print link for the author (left out for a colleague's test). `available`
   * is false without `AUTH_SECRET`; `mail` says whether e-mail is configured.
   */
  share?: { available: boolean; mail: boolean }
}) {
  // Rendering the PDF takes seconds; without this the click seemed to do nothing.
  const [work, setWork] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const shareMutation = useMutation({ mutationFn: requestShareLink })

  /** The link points at the saved test, so unsaved changes are saved first. */
  async function openShare() {
    setWork(t('tests:share.creating'))
    try {
      const id = unsaved || !testId ? ((await ensureSaved?.()) ?? null) : testId
      if (!id) return
      setShareOpen(true)
      shareMutation.mutate(id)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWork(null)
    }
  }

  async function run(action: PrintAction) {
    setWork(action.busyLabel)
    try {
      const id = unsaved || !testId ? ((await ensureSaved?.()) ?? null) : testId
      if (!id) return
      // The labels did not depend on the id; the action is rebuilt for the saved one.
      const ready = printGroups(id, variants)
        .flatMap((group) => group.actions)
        .find((candidate) => candidate.key === action.key)
      await ready?.run()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWork(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={work !== null} aria-busy={work !== null || undefined}>
            {work ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {work}
              </>
            ) : (
              t('tests:print.menu')
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={unsaved ? 'max-w-xs' : undefined}>
          {unsaved ? (
            <DropdownMenuLabel className="text-xs font-normal text-fg-soft" data-testid="print-save-first">
              {t('tests:print.saveFirst')}
            </DropdownMenuLabel>
          ) : null}
          <PrintMenuItems testId={testId ?? ''} variants={variants} onRun={(action) => void run(action)} />
          {share ? (
            <>
              <DropdownMenuSeparator />
              {share.available ? (
                <DropdownMenuItem onSelect={() => void openShare()}>{t('tests:share.menuItem')}</DropdownMenuItem>
              ) : (
                <DropdownMenuLabel className="text-xs font-normal text-fg-soft" data-testid="share-unavailable">
                  {t('tests:share.unavailable')}
                </DropdownMenuLabel>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {share ? (
        <ShareLinkDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          link={shareMutation.data ?? null}
          pending={shareMutation.isPending}
          error={shareMutation.error ? errorMessage(shareMutation.error, t('tests:share.createFailed')) : null}
          mail={share.mail}
        />
      ) : null}
    </>
  )
}
