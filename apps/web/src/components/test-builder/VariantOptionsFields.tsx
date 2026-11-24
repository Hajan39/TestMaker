'use client'

import type { VariantOptions } from '@testmaker/core/schema'
import { Button, Checkbox, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * How variant B is built: question order, a new shuffle, and shuffling options
 * inside questions. Sits in the A/B bar above the page, next to the preview of
 * B it changes; `disabled` for a colleague who may only read the test.
 */
export function VariantOptionsFields({
  value,
  onChange,
  disabled = false,
}: {
  value: VariantOptions
  onChange: (next: VariantOptions) => void
  disabled?: boolean
}) {
  return (
    <fieldset disabled={disabled} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="test-variant-order">{t('tests:settings.variantOrder')}</Label>
        <Select
          value={value.order}
          disabled={disabled}
          onValueChange={(next) => onChange({ ...value, order: next === 'reverse' ? 'reverse' : 'shuffle' })}
        >
          <SelectTrigger id="test-variant-order" size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shuffle">{t('tests:settings.variantOrderShuffle')}</SelectItem>
            <SelectItem value="reverse">{t('tests:settings.variantOrderReverse')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {value.order === 'shuffle' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-describedby="test-variant-reshuffle-hint"
          onClick={() => onChange({ ...value, seed: value.seed + 1 })}
        >
          {t('tests:settings.variantReshuffle')}
        </Button>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-fg-soft">
        <Checkbox
          checked={value.shuffleOptions}
          onCheckedChange={() => onChange({ ...value, shuffleOptions: !value.shuffleOptions })}
        />
        {t('tests:settings.variantShuffleOptions')}
      </label>
      {value.order === 'shuffle' ? (
        <p id="test-variant-reshuffle-hint" className="basis-full text-xs text-fg-muted">
          {t('tests:settings.variantReshuffleHint')}
        </p>
      ) : null}
    </fieldset>
  )
}
