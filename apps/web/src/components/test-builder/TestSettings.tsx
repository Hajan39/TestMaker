'use client'

import type { Template } from '@testmaker/core/schema'
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { TemplatePreview } from '@/components/TemplatePreview'
import type { TestSettingsValue } from './types'

/**
 * Test settings — subtitle, header, template and variants. Opens from the bar
 * as a Sheet, not as a block above the content. The test title does not belong
 * here: the test cannot be saved without it, so it sits in the builder header
 * where it is visible without opening anything.
 */
export function TestSettings({
  value,
  templates,
  onChange,
  worksheet = false,
}: {
  value: TestSettingsValue
  templates: Template[]
  onChange: (next: TestSettingsValue) => void
  /** Worksheet: no grades and no variants — nothing on a worksheet is graded or copied. */
  worksheet?: boolean
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          {worksheet ? t('tests:settings.titleWorksheet') : t('tests:settings.title')}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{worksheet ? t('tests:settings.titleWorksheet') : t('tests:settings.title')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <div>
            <Label htmlFor="test-description">{t('tests:settings.description')}</Label>
            <Input
              id="test-description"
              value={value.description}
              maxLength={1000}
              onChange={(event) => onChange({ ...value, description: event.target.value })}
            />
          </div>

          <div className={worksheet ? 'hidden' : undefined}>
            <Label htmlFor="test-variants">{t('tests:settings.variants')}</Label>
            <Select
              value={String(value.variants)}
              onValueChange={(next) => onChange({ ...value, variants: next === '2' ? 2 : 1 })}
            >
              <SelectTrigger id="test-variants" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t('tests:settings.variantsA')}</SelectItem>
                <SelectItem value="2">{t('tests:settings.variantsAB')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="test-header-school">{t('tests:settings.school')}</Label>
              <Input
                id="test-header-school"
                value={value.header.school}
                onChange={(event) => onChange({ ...value, header: { ...value.header, school: event.target.value } })}
              />
            </div>
            <div>
              <Label htmlFor="test-header-subject">{t('tests:settings.subject')}</Label>
              <Input
                id="test-header-subject"
                value={value.header.subject}
                onChange={(event) => onChange({ ...value, header: { ...value.header, subject: event.target.value } })}
              />
            </div>
            <div>
              <Label htmlFor="test-header-class">{t('tests:settings.className')}</Label>
              <Input
                id="test-header-class"
                value={value.header.className}
                placeholder={t('tests:settings.blankLine')}
                onChange={(event) =>
                  onChange({ ...value, header: { ...value.header, className: event.target.value } })
                }
              />
            </div>
            <div>
              <Label htmlFor="test-header-date">{t('tests:settings.date')}</Label>
              <Input
                id="test-header-date"
                value={value.header.date}
                placeholder={t('tests:settings.blankLine')}
                onChange={(event) => onChange({ ...value, header: { ...value.header, date: event.target.value } })}
              />
            </div>
          </div>

          <div>
            <Label>{t('tests:settings.template')}</Label>
            <div className="grid grid-cols-2 gap-3">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onChange({ ...value, templateId: template.id })}
                  className={
                    'rounded-lg border p-1.5 text-left transition-colors ' +
                    (template.id === value.templateId
                      ? 'border-brand bg-brand-bg'
                      : 'border-line hover:border-fg-muted')
                  }
                >
                  <TemplatePreview templateId={template.id} graded={value.graded} decorative />
                  <span className="mt-1.5 block px-1 text-sm font-medium text-fg-soft">{template.name}</span>
                  <span className="block px-1 pb-1 text-xs text-fg-muted">{template.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* The answer key is not set here: it is chosen at print time,
              between "Zadání pro žáky" and "Vyplněná pro mě". */}
          <div className="flex flex-wrap gap-5">
            <label className={worksheet ? 'hidden' : 'flex items-center gap-2 text-sm text-fg-soft'}>
              <Checkbox
                checked={value.graded}
                onCheckedChange={() => onChange({ ...value, graded: !value.graded })}
              />
              {t('tests:settings.graded')}
            </label>
            {/* Otherwise a test is visible only to its author. Sharing helps when
                someone is ill and a colleague covers the class — she can at
                least print it instead of building it again. */}
            <label className="flex items-center gap-2 text-sm text-fg-soft">
              <Checkbox
                checked={value.visibility === 'skola'}
                onCheckedChange={() =>
                  onChange({
                    ...value,
                    visibility: value.visibility === 'skola' ? 'soukrome' : 'skola',
                  })
                }
              />
              {t('tests:settings.share')}
            </label>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
