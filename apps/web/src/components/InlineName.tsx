'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, X } from 'lucide-react'
import { Button, Input, cn } from '@testmaker/ui'
import { useCanEdit } from '@/components/Permissions'
import type { LibraryKind } from '@/lib/library'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

/**
 * In-place rename: clicking the pencil turns the name into a field.
 *
 * A dialog would be needless ceremony — it's one word and its new form belongs
 * exactly where the name stands. Enter saves, Escape cancels; a server error
 * (e.g. two topics with the same name) shows below the field.
 */
export function InlineName({
  kind,
  id,
  name,
  as: NameTag = 'span',
  className,
  inputClassName,
  label,
}: {
  kind: LibraryKind
  id: string
  name: string
  /**
   * What renders the name itself. A page heading must stay a heading and must
   * not absorb the neighbouring button's label into its name, so the button
   * always comes after it, never inside.
   */
  as?: 'span' | 'h1' | 'h2'
  /** Classes for the name text, so it works both in a heading and in a tile. */
  className?: string
  inputClassName?: string
  /** Button label for screen readers. */
  label?: string
}) {
  const router = useRouter()
  const canEdit = useCanEdit()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Once editing starts, focus belongs in the field, otherwise the teacher has to click twice.
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function save() {
    const next = value.trim()
    if (!next || next === name) {
      setEditing(false)
      setValue(name)
      return
    }

    setBusy(true)
    setError(null)
    try {
      await requestJson('/api/library', jsonBody('PATCH', { kind, id, name: next }), t('library:inlineName.failed'))
      setEditing(false)
      router.refresh()
    } catch (saveError) {
      setError(errorMessage(saveError, t('library:inlineName.failed')))
    } finally {
      setBusy(false)
    }
  }

  // A viewer only reads — no pencil, so the UI shows right away that renaming
  // isn't possible, not only via a refused request.
  if (!canEdit) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <NameTag className={cn('min-w-0 flex-1 truncate', className)}>{name}</NameTag>
      </span>
    )
  }

  if (!editing) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <NameTag className={cn('min-w-0 flex-1 truncate', className)}>{name}</NameTag>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label={label ?? t('library:inlineName.renameNamed', { name })}
          title={label ?? t('library:inlineName.rename')}
          onClick={(event) => {
            // A tile is often a link; the pencil mustn't navigate anywhere.
            event.preventDefault()
            event.stopPropagation()
            // The field is filled here, not in an effect: state changed during
            // render leads to cascading re-renders and React warns about it.
            setValue(name)
            setEditing(true)
          }}
        >
          <Pencil aria-hidden />
        </Button>
      </span>
    )
  }

  return (
    <span
      className="flex min-w-0 flex-1 flex-col gap-1"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <span className="flex min-w-0 items-center gap-1">
        <Input
          ref={inputRef}
          value={value}
          disabled={busy}
          aria-label={label ?? t('library:inlineName.newName')}
          aria-invalid={error ? true : undefined}
          className={cn('h-8 min-w-0 flex-1', inputClassName)}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
            if (event.key === 'Escape') {
              setEditing(false)
              setValue(name)
              setError(null)
            }
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label={t('library:inlineName.saveName')}
          title={t('common:actions.save')}
          onClick={() => void save()}
        >
          <Check aria-hidden />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label={t('library:inlineName.cancelRename')}
          title={t('common:actions.cancel')}
          onClick={() => {
            setEditing(false)
            setValue(name)
            setError(null)
          }}
        >
          <X aria-hidden />
        </Button>
      </span>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  )
}
