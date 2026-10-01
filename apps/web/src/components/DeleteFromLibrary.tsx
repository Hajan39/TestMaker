'use client'

import { useRouter } from 'next/navigation'
import { DeleteButton, toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { useCanManage } from '@/components/Permissions'
import { errorMessage, requestJson } from '@/lib/requestJson'

type Kind = 'subject' | 'grade' | 'topic'

interface Impact {
  name: string
  grades: number
  topics: number
  materials: number
  questions: number
  affectedTests: string[]
}

/** Describes the impact in plain words: only what is actually affected. */
function describeImpact(impact: Impact) {
  const parts: string[] = []
  if (impact.grades > 0) parts.push(t('library:count.grades', { count: impact.grades }))
  if (impact.topics > 0) parts.push(t('library:count.topics', { count: impact.topics }))
  if (impact.materials > 0) parts.push(t('library:count.materials', { count: impact.materials }))
  // In the sentence "smaže se … a s ním 5 otázek" the question is in the accusative.
  if (impact.questions > 0) parts.push(t('library:deleteFromLibrary.questionsAccusative', { count: impact.questions }))

  return (
    <>
      <p>
        {t('library:deleteFromLibrary.impactLead')} <strong>{impact.name}</strong>
        {parts.length > 0 ? (
          <> {t('library:deleteFromLibrary.impactWith', { parts: parts.join(', ') })}</>
        ) : (
          <> {t('library:deleteFromLibrary.impactNothing')}</>
        )}
      </p>
      {impact.affectedTests.length > 0 ? (
        <p className="text-danger">
          {t('library:deleteFromLibrary.affectedTests', { tests: impact.affectedTests.join(', ') })}
        </p>
      ) : null}
      {impact.materials > 0 ? (
        <p className="text-fg-muted">
          {t('library:deleteFromLibrary.filesStay')}
        </p>
      ) : null}
    </>
  )
}

/** Deleting a subject, grade or topic including everything below it. */
export function DeleteFromLibrary({
  kind,
  id,
  label,
  iconOnly = false,
  redirectTo,
}: {
  kind: Kind
  id: string
  label?: string
  /** Only the bin icon; the label shows on hover. */
  iconOnly?: boolean
  /** Where to go after deleting; without it the page just refreshes. */
  redirectTo?: string
}) {
  // Only an admin may delete in the library (`DELETE /api/library`) — the
  // button isn't offered to a teacher or viewer at all. The guard sits after
  // the hooks so the same number of them is called on every render.
  const canManage = useCanManage()
  const router = useRouter()
  if (!canManage) return null

  return (
    <DeleteButton
      label={label ?? t(`library:deleteFromLibrary.title.${kind}`)}
      iconOnly={iconOnly}
      title={t('library:deleteFromLibrary.confirmTitle', { title: t(`library:deleteFromLibrary.title.${kind}`) })}
      confirmLabel={t('common:actions.delete')}
      describe={async () => {
        // Without catching, a network error would leave empty skeletons instead of the impact.
        try {
          const response = await fetch(`/api/library?kind=${kind}&id=${encodeURIComponent(id)}`)
          if (response.ok) return describeImpact((await response.json()) as Impact)
        } catch {
          // Message below.
        }
        return (
          <p className="text-danger">
            {t('library:deleteFromLibrary.impactFailed')}
          </p>
        )
      }}
      onConfirm={async () => {
        // The error is rethrown — `DeleteButton` waits for it so it doesn't
        // close the dialog and pretend a success that didn't happen.
        try {
          await requestJson(
            `/api/library?kind=${kind}&id=${encodeURIComponent(id)}`,
            { method: 'DELETE' },
            t('library:deleteFromLibrary.failed'),
          )
        } catch (error) {
          toast.error(errorMessage(error, t('library:deleteFromLibrary.failed')))
          throw error
        }
        if (redirectTo) router.push(redirectTo)
        router.refresh()
      }}
    />
  )
}
