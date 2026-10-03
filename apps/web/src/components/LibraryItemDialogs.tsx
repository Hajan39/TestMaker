'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import {
  BusyButton,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@testmaker/ui'
import type { LibraryKind } from '@/lib/library'
import { useCanEdit } from '@/components/Permissions'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

/**
 * Creating and renaming in the library.
 *
 * Until now a subject, grade or topic could only come from importing files.
 * But the teacher also needs an empty topic to write her own questions into,
 * and a way to fix a subject name that came from an upper-case folder name.
 *
 * Both actions share one dialog with a single name field: they differ only in
 * what is sent to `/api/library` and where to go afterwards.
 */

interface NameDialogProps {
  title: string
  fieldLabel: string
  hint?: string
  initialName: string
  confirmLabel: string
  busyLabel: string
  trigger: ReactNode
  /** Rejects with a `RequestError` (from `requestJson`) when the action failed. */
  onSubmit: (name: string) => Promise<unknown>
}

function NameDialog({
  title,
  fieldLabel,
  hint,
  initialName,
  confirmLabel,
  busyLabel,
  trigger,
  onSubmit,
}: NameDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)

  function change(next: boolean) {
    setOpen(next)
    // Every open and close resets the field to the current name and clears the
    // error. Reopening the dialog to find a half-typed name, a stale error or a
    // name that has changed meanwhile would be confusing.
    setName(initialName)
    setError(null)
  }

  const submitMutation = useMutation({
    mutationFn: onSubmit,
    onSuccess: () => change(false),
    // A network error used to show nothing — the button just went idle again.
    onError: (submitError) => setError(errorMessage(submitError, t('library:itemDialogs.saveFailed'))),
  })
  const busy = submitMutation.isPending

  function submit() {
    if (!name.trim() || busy) return
    setError(null)
    submitMutation.mutate(name.trim())
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint ? <DialogDescription>{hint}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="library-item-name">{fieldLabel}</Label>
          <Input
            id="library-item-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>
            {t('common:actions.cancel')}
          </Button>
          <BusyButton busy={busy} busyLabel={busyLabel} disabled={!name.trim()} onClick={submit}>
            {confirmLabel}
          </BusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A "Nový předmět / ročník / téma" button with a name dialog.
 * `parentId` is the subject for a grade and the grade for a topic; not set for a subject.
 */
export function NewLibraryItem({
  kind,
  parentId,
  label,
  iconOnly = false,
  size = 'sm',
  variant = 'outline',
}: {
  kind: LibraryKind
  parentId?: string
  label?: string
  /** Icon only with a hover label — for places where per-item texts would pile up. */
  iconOnly?: boolean
  size?: ComponentProps<typeof Button>['size']
  variant?: ComponentProps<typeof Button>['variant']
}) {
  // A viewer doesn't change the library, so it neither creates nor renames. The
  // guard sits after the hooks so the same number of them is called on every render.
  const canEdit = useCanEdit()
  const router = useRouter()
  const fieldLabel = label ?? t(`library:itemDialogs.${kind}.newItem`)
  if (!canEdit) return null

  return (
    <NameDialog
      title={t(`library:itemDialogs.${kind}.newItem`)}
      fieldLabel={t(`library:itemDialogs.${kind}.label`)}
      hint={t(`library:itemDialogs.${kind}.hint`)}
      initialName=""
      confirmLabel={t('library:itemDialogs.create')}
      busyLabel={t('library:itemDialogs.creating')}
      trigger={
        iconOnly ? (
          <Button size="icon-sm" variant={variant} aria-label={fieldLabel} title={fieldLabel}>
            <Plus aria-hidden />
          </Button>
        ) : (
          <Button size={size} variant={variant}>
            {fieldLabel}
          </Button>
        )
      }
      onSubmit={async (name) => {
        const { id } = await requestJson<{ id: string }>(
          '/api/library',
          jsonBody('POST', { kind, name, parentId: parentId ?? null }),
          t('library:itemDialogs.saveFailed'),
        )
        // After creating, it helps to land right where work continues:
        // questions are written in a new topic, topics are created in a new grade.
        if (kind === 'topic') router.push(`/topics/${id}`)
        else if (kind === 'grade') router.push(`/tridy/${id}`)
        router.refresh()
      }}
    />
  )
}

/**
 * A "Přejmenovat" button on a library item. `iconOnly` is for places where a
 * label on every item would drown out what matters — e.g. on topic tiles.
 */
export function RenameLibraryItem({
  kind,
  id,
  name,
  label,
  iconOnly = false,
  size = 'sm',
  variant = 'ghost',
}: {
  kind: LibraryKind
  id: string
  name: string
  label?: string
  iconOnly?: boolean
  size?: ComponentProps<typeof Button>['size']
  variant?: ComponentProps<typeof Button>['variant']
}) {
  // Same as for creating: a viewer only reads.
  const canEdit = useCanEdit()
  const router = useRouter()
  const fieldLabel = label ?? t(`library:itemDialogs.${kind}.rename`)
  if (!canEdit) return null

  return (
    <NameDialog
      title={t(`library:itemDialogs.${kind}.rename`)}
      fieldLabel={t(`library:itemDialogs.${kind}.label`)}
      initialName={name}
      confirmLabel={t('common:actions.save')}
      busyLabel={t('common:actions.saving')}
      trigger={
        iconOnly ? (
          <Button size="icon-sm" variant={variant} aria-label={fieldLabel} title={fieldLabel}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button size={size} variant={variant}>
            {fieldLabel}
          </Button>
        )
      }
      onSubmit={async (next) => {
        await requestJson('/api/library', jsonBody('PATCH', { kind, id, name: next }), t('library:itemDialogs.saveFailed'))
        router.refresh()
      }}
    />
  )
}
