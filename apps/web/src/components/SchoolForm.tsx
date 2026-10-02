'use client'

import { useId, useState } from 'react'
import { t } from '@testmaker/core/i18n'
import { BusyButton, Checkbox, Input, Label } from '@testmaker/ui'
import { SCHOOL_DETAIL_KEYS, type SchoolDetails } from '@/lib/schoolDetails'

export type SchoolSettings = {
  name: string
  googleDomain: string
  googleAutoJoin: boolean
} & SchoolDetails

/**
 * Name, Google domain, automatic joining and below them address and contacts —
 * the same fields in managing the own school, in administration and when
 * creating a new one. The caller does
 * the saving; the form only returns what is in the fields.
 */
export function SchoolForm({
  initial,
  submitLabel,
  onSave,
}: {
  initial: SchoolSettings
  submitLabel: string
  /** Returns `true` when saved — the new-school form then clears itself. */
  onSave: (settings: SchoolSettings) => Promise<boolean>
}) {
  const id = useId()
  const [settings, setSettings] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      if ((await onSave(settings)) && !initial.name) setSettings(initial)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Label htmlFor={`${id}-name`}>{t('admin:schoolForm.name')}</Label>
          <Input
            id={`${id}-name`}
            value={settings.name}
            onChange={(event) => setSettings({ ...settings, name: event.target.value })}
          />
        </div>
        <div className="w-56">
          <Label htmlFor={`${id}-domain`}>{t('admin:schoolForm.googleDomain')}</Label>
          <Input
            id={`${id}-domain`}
            placeholder={t('admin:schoolForm.domainPlaceholder')}
            value={settings.googleDomain}
            onChange={(event) => setSettings({ ...settings, googleDomain: event.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-fg">
          <Checkbox
            checked={settings.googleAutoJoin}
            onCheckedChange={(checked) => setSettings({ ...settings, googleAutoJoin: checked === true })}
          />
          {t('admin:schoolForm.autoJoin')}
        </label>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="ui-label mb-2">{t('admin:schoolForm.detailsLegend')}</legend>
        {SCHOOL_DETAIL_KEYS.map((key) => (
          <div key={key}>
            <Label htmlFor={`${id}-${key}`}>{t(`admin:schoolForm.details.${key}.label`)}</Label>
            <Input
              id={`${id}-${key}`}
              placeholder={t(`admin:schoolForm.details.${key}.placeholder`)}
              value={settings[key]}
              onChange={(event) => setSettings({ ...settings, [key]: event.target.value })}
            />
          </div>
        ))}
      </fieldset>

      <BusyButton
        type="submit"
        busy={busy}
        busyLabel={t('actions.saving')}
        disabled={!settings.name.trim()}
      >
        {submitLabel}
      </BusyButton>
    </form>
  )
}
