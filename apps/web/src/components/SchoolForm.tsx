'use client'

import { useId } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
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
  const { register, control, handleSubmit, reset, formState } = useForm<SchoolSettings>({ defaultValues: initial })
  const name = useWatch({ control, name: 'name' })

  async function submit(settings: SchoolSettings) {
    // A new school's form starts empty again after it was created.
    if ((await onSave(settings)) && !initial.name) reset(initial)
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit(submit)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Label htmlFor={`${id}-name`}>{t('admin:schoolForm.name')}</Label>
          <Input
            id={`${id}-name`}
            // The server must render the value too: `register` alone fills it only
            // after hydration, and typing before that would be glued to it.
            defaultValue={initial.name}
            {...register('name')}
          />
        </div>
        <div className="w-56">
          <Label htmlFor={`${id}-domain`}>{t('admin:schoolForm.googleDomain')}</Label>
          <Input
            id={`${id}-domain`}
            placeholder={t('admin:schoolForm.domainPlaceholder')}
            defaultValue={initial.googleDomain}
            {...register('googleDomain')}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-fg">
          <Controller
            control={control}
            name="googleAutoJoin"
            render={({ field }) => (
              <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
            )}
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
              defaultValue={initial[key]}
              {...register(key)}
            />
          </div>
        ))}
      </fieldset>

      <BusyButton
        type="submit"
        busy={formState.isSubmitting}
        busyLabel={t('actions.saving')}
        disabled={!name.trim()}
      >
        {submitLabel}
      </BusyButton>
    </form>
  )
}
