'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Badge,
  Checkbox,
  DeleteButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  toast,
} from '@testmaker/ui'
import { useCanEdit } from '@/components/Permissions'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

export interface GroupMaterial {
  id: string
  fileName: string
  charCount: number
  pageCount: number | null
  needsOcr: boolean
  duplicateOfId: string | null
  duplicateScore: number | null
  /** Manually excluded from generation — the material stays in the topic, it just isn't used. */
  excluded: boolean
}

/**
 * One material row in the strip: name, text size, duplicate note, the
 * "Použít pro generování" toggle and delete. Moving to another topic is offered
 * only in "Upravit téma" mode — it changes the filing, not the material itself.
 */
export function MaterialRow({
  material,
  originalFileName,
  manage,
  siblings,
  optionsReady,
  busy,
  onMove,
}: {
  material: GroupMaterial
  /** Name of the material this one duplicates — for the "stejný obsah jako …" note. */
  originalFileName: string | null
  manage: boolean
  siblings: { id: string; name: string }[]
  optionsReady: boolean
  busy: boolean
  onMove: (topicId: string) => void
}) {
  const router = useRouter()
  const canEdit = useCanEdit()
  const [excludePending, setExcludePending] = useState(false)
  // Optimistic change: the check shows immediately, not after `router.refresh()`.
  // When the server refuses, it flips back and the teacher gets a message —
  // otherwise the checkbox would silently stay in a state that wasn't saved.
  const [excludedOverride, setExcludedOverride] = useState(material.excluded)
  // A new value from the server is adopted right during render — an effect
  // would render twice and the checkbox would flicker.
  const [lastExcluded, setLastExcluded] = useState(material.excluded)
  if (material.excluded !== lastExcluded) {
    setLastExcluded(material.excluded)
    setExcludedOverride(material.excluded)
  }

  async function toggleExcluded() {
    const next = !excludedOverride
    setExcludedOverride(next)
    setExcludePending(true)
    try {
      await requestJson(
        '/api/materials',
        jsonBody('PATCH', { id: material.id, excluded: next }),
        t('library:materialRow.saveFailed'),
      )
      router.refresh()
    } catch (saveError) {
      setExcludedOverride(!next)
      toast.error(errorMessage(saveError, t('library:materialRow.saveFailedRetry')))
    } finally {
      setExcludePending(false)
    }
  }

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-material-id={material.id}>
      {/* File names tend to be long and without spaces, so they must break even mid-word. */}
      <span
        className={cn(
          'min-w-0 break-all',
          material.duplicateOfId || excludedOverride ? 'text-fg-muted' : 'text-fg-soft',
        )}
        title={material.fileName}
      >
        {material.fileName}
      </span>
      <span className="shrink-0 text-fg-muted">
        {t('library:materialRow.chars', { chars: material.charCount.toLocaleString('cs') })}
        {material.pageCount ? t('library:materialRow.pages', { pages: material.pageCount }) : ''}
      </span>
      {material.needsOcr ? (
        <Badge className="shrink-0 bg-draft-bg text-draft-fg">{t('library:materialRow.needsOcr')}</Badge>
      ) : null}
      {material.duplicateOfId ? (
        <span className="min-w-0 break-all text-xs text-fg-muted">
          {t('library:materialRow.duplicateOf', { name: originalFileName ?? t('library:materialRow.otherMaterial') })}
          {material.duplicateScore
            ? t('library:materialRow.duplicateScore', { percent: Math.round(material.duplicateScore * 100) })
            : ''}
        </span>
      ) : null}

      {canEdit ? (
        <label className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
          <Checkbox
            checked={!material.duplicateOfId && !excludedOverride}
            disabled={excludePending || !!material.duplicateOfId}
            aria-label={t('library:materialRow.useForGenerationAria', { name: material.fileName })}
            onCheckedChange={() => void toggleExcluded()}
          />
          {t('library:materialRow.useForGeneration')}
        </label>
      ) : null}

      {canEdit && manage && (!optionsReady || siblings.length > 0) ? (
        <Select
          value="move"
          disabled={busy || !optionsReady}
          onValueChange={(value) => value !== 'move' && onMove(value)}
        >
          <SelectTrigger className="w-full shrink-0 sm:w-56" aria-busy={!optionsReady || undefined}>
            {optionsReady ? <SelectValue /> : <span className="text-fg-muted">{t('library:materialRow.loadingTopics')}</span>}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="move">{t('library:materialRow.moveTo')}</SelectItem>
            {siblings.map((sibling) => (
              <SelectItem key={sibling.id} value={sibling.id}>
                {sibling.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {canEdit ? (
        <DeleteButton
          label={t('common:actions.delete')}
          title={t('library:materialRow.deleteTitle')}
          description={t('library:materialRow.deleteDescription', { name: material.fileName })}
          onConfirm={async () => {
            // The error is rethrown — `DeleteButton` then keeps the dialog
            // open instead of pretending a success that didn't happen.
            try {
              await requestJson(
                `/api/materials?id=${encodeURIComponent(material.id)}`,
                { method: 'DELETE' },
                t('library:materialRow.deleteFailed'),
              )
            } catch (deleteError) {
              toast.error(errorMessage(deleteError, t('library:materialRow.deleteFailed')))
              throw deleteError
            }
            toast.success(t('library:materialRow.deleted', { name: material.fileName }))
            router.refresh()
          }}
        />
      ) : null}
    </li>
  )
}
