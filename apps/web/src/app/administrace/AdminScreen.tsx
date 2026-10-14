'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
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
  const saveMutation = useMutation({
    mutationFn: ({ method, body }: { method: 'POST' | 'PATCH'; body: object; message: string }) =>
      requestJson('/api/administrace/skoly', jsonBody(method, body), t('admin:errors.changeFailed')),
    onSuccess: (_data, { message }) => {
      toast.success(message)
      router.refresh()
    },
    onError: (error) => toast.error(errorMessage(error, t('admin:errors.changeFailed'))),
  })
  // Resolves to whether the save worked — the form decides from it whether to reset.
  const send = (method: 'POST' | 'PATCH', body: object, message: string) =>
    saveMutation.mutateAsync({ method, body, message }).then(
      () => true,
      () => false,
    )

  const switchMutation = useMutation({
    mutationFn: (schoolId: string) =>
      requestJson('/api/administrace/skola', jsonBody('POST', { schoolId }), t('admin:errors.switchFailed')),
    onSuccess: () => {
      router.push('/')
      router.refresh()
    },
    onError: (error) => toast.error(errorMessage(error, t('admin:errors.switchFailed'))),
  })
  /** The school being switched to — a double click would send two requests. The button stays disabled until leaving for the home page. */
  const switching = switchMutation.isPending || switchMutation.isSuccess ? switchMutation.variables : null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ui-page-title">{t('admin:schools.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-soft">{t('admin:schools.intro')}</p>
      </div>

      {aiUsage}

      <Card>
        <h2 className="mb-3 font-medium text-fg">{t('admin:schools.newSchool')}</h2>
        <SchoolForm
          initial={EMPTY}
          submitLabel={t('admin:schools.createSchool')}
          onSave={(settings) => send('POST', settings, t('admin:schools.created', { name: settings.name.trim() }))}
        />
      </Card>

      <div className="space-y-2">
        {schools.map((school) => (
          <Card key={school.id} className="space-y-3">
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
                  onClick={() => switchMutation.mutate(school.id)}
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
