'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from '@testmaker/ui'
import { useCanEdit } from '@/components/Permissions'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

const WITHOUT_GRADE = 'no-grade'
const PLACEHOLDER = 'move'

function toValue(gradeName: string): string {
  return gradeName === '' ? WITHOUT_GRADE : gradeName
}

/**
 * Moving a topic to another grade of the same subject — on the class page,
 * where topics are rearranged between grades most often. The grade options
 * load only on open, so no more queries are made than needed.
 */
export function MoveTopic({ topicId, currentGradeName }: { topicId: string; currentGradeName: string }) {
  const canEdit = useCanEdit()
  const router = useRouter()
  const [grades, setGrades] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState(false)

  // The guard sits after the hooks so the same number of them is called on every render.
  if (!canEdit) return null

  async function ensureLoaded() {
    if (grades !== null) return
    try {
      const data = await requestJson<{ grades: { id: string; name: string }[] }>(
        `/api/topics?gradesOf=${encodeURIComponent(topicId)}`,
        undefined,
        t('library:moveTopic.loadFailed'),
      )
      setGrades(data.grades ?? [])
    } catch (error) {
      toast.error(errorMessage(error, t('library:moveTopic.loadFailed')))
    }
  }

  async function move(gradeName: string) {
    setBusy(true)
    try {
      await requestJson('/api/topics', jsonBody('PATCH', { id: topicId, gradeName }), t('library:moveTopic.failed'))
      toast.success(t('library:moveTopic.moved', { grade: gradeName || t('library:labels.noGrade') }), {
        testId: 'toast-topic-moved',
      })
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('library:moveTopic.failedRetry')))
    } finally {
      setBusy(false)
    }
  }

  const options = (grades ?? []).filter((grade) => grade.name !== currentGradeName)

  return (
    <Select
      value={PLACEHOLDER}
      disabled={busy}
      onValueChange={(value) => {
        if (value === PLACEHOLDER) return
        void move(value === WITHOUT_GRADE ? '' : value)
      }}
      onOpenChange={(open) => {
        if (open) void ensureLoaded()
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-7 w-auto border-none bg-transparent px-1 text-xs text-fg-muted shadow-none hover:text-fg"
        aria-label={t('library:moveTopic.label')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PLACEHOLDER}>{t('library:moveTopic.placeholder')}</SelectItem>
        {grades !== null && options.length === 0 ? (
          <SelectItem value="none" disabled>
            {t('library:moveTopic.noOtherGrade')}
          </SelectItem>
        ) : null}
        {options.map((grade) => (
          <SelectItem key={grade.id} value={toValue(grade.name)}>
            {grade.name || t('library:labels.noGrade')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
