'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { t } from '@testmaker/core/i18n'
import { Badge, BusyButton, Card, toast } from '@testmaker/ui'
import { SchoolForm, type SchoolSettings } from '@/components/SchoolForm'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import type { SchoolRow } from '@/lib/schools'
import { EMPTY_DETAILS, detailsFromRow } from '@/lib/schoolDetails'

const EMPTY: SchoolSettings = { name: '', googleDomain: '', googleAutoJoin: false, ...EMPTY_DETAILS }

export function AdminScreen({
  schools,
  current,
  homeSchool,
  aiUsage,
}: {
  schools: SchoolRow[]
  /** The school the administrator is working in right now. */
  current: string
  homeSchool: string
  /** AI usage overview; rendered by the server, arrives here finished. */
  aiUsage?: ReactNode
}) {
  const router = useRouter()
  /** The school being switched to — a double click would send two requests. */
  const [switching, setSwitching] = useState<string | null>(null)

  async function send(method: 'POST' | 'PATCH', body: object, message: string) {
    try {
      await requestJson('/api/administrace/skoly', jsonBody(method, body), t('admin:errors.changeFailed'))
    } catch (error) {
      toast.error(errorMessage(error, t('admin:errors.changeFailed')))
      return false
    }
    toast.success(message)
    router.refresh()
    return true
  }

  async function switchTo(schoolId: string) {
    setSwitching(schoolId)
    try {
      await requestJson('/api/administrace/skola', jsonBody('POST', { schoolId }), t('admin:errors.switchFailed'))
    } catch (error) {
      toast.error(errorMessage(error, t('admin:errors.switchFailed')))
      setSwitching(null)
      return
    }
    // The button stays disabled until leaving for the home page.
    router.push('/')
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ui-page-title">{t('admin:schools.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-soft">{t('admin:schools.intro')}</p>
      </div>

      {aiUsage}

      <Card className="p-4">
        <h2 className="mb-3 font-medium text-fg">{t('admin:schools.newSchool')}</h2>
        <SchoolForm
          initial={EMPTY}
          submitLabel={t('admin:schools.createSchool')}
          onSave={(settings) => send('POST', settings, t('admin:schools.created', { name: settings.name.trim() }))}
        />
      </Card>

      <div className="space-y-2">
        {schools.map((school) => (
          <Card key={school.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium text-fg">{school.name}</h2>
              {school.id === homeSchool ? <Badge variant="secondary">{t('admin:schools.home')}</Badge> : null}
              {school.id === current ? <Badge>{t('admin:schools.current')}</Badge> : null}
              <span className="ui-numeric text-xs text-fg-muted">
                {t('admin:schools.meta', { slug: school.slug, accounts: school.accountCount })}
              </span>
              {school.id !== current ? (
                <BusyButton
                  className="ml-auto"
                  size="sm"
                  variant="outline"
                  busy={switching === school.id}
                  busyLabel={t('admin:schools.switching')}
                  disabled={switching !== null}
                  onClick={() => void switchTo(school.id)}
                >
                  {t('admin:schools.switchHere')}
                </BusyButton>
              ) : null}
            </div>
            <SchoolForm
              initial={{
                name: school.name,
                googleDomain: school.googleDomain ?? '',
                googleAutoJoin: school.googleAutoJoin,
                ...detailsFromRow(school),
              }}
              submitLabel={t('actions.save')}
              onSave={(settings) => send('PATCH', { id: school.id, ...settings }, t('admin:schools.saved'))}
            />
          </Card>
        ))}
      </div>
    </div>
  )
}
