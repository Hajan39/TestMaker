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
import { TemplatePreview } from '@/components/TemplatePreview'
import type { TestSettingsValue } from './types'

/**
 * Nastavení testu — podtitul, hlavička, šablona a varianty. Otevírá se z lišty
 * jako Sheet, ne jako blok nad obsahem. Název písemky sem nepatří: bez něj se
 * test neuloží, takže stojí v hlavičce skladače, kde je vidět bez otevírání.
 */
export function TestSettings({
  value,
  templates,
  onChange,
}: {
  value: TestSettingsValue
  templates: Template[]
  onChange: (next: TestSettingsValue) => void
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          Nastavení testu
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Nastavení testu</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <div>
            <Label htmlFor="test-description">Podtitul / úvodní věta (nepovinné)</Label>
            <Input
              id="test-description"
              value={value.description}
              onChange={(event) => onChange({ ...value, description: event.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="test-variants">Varianty</Label>
            <Select
              value={String(value.variants)}
              onValueChange={(next) => onChange({ ...value, variants: next === '2' ? 2 : 1 })}
            >
              <SelectTrigger id="test-variants" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Jen A</SelectItem>
                <SelectItem value="2">A i B (přeházené pořadí)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="test-header-school">Škola</Label>
              <Input
                id="test-header-school"
                value={value.header.school}
                onChange={(event) => onChange({ ...value, header: { ...value.header, school: event.target.value } })}
              />
            </div>
            <div>
              <Label htmlFor="test-header-subject">Předmět</Label>
              <Input
                id="test-header-subject"
                value={value.header.subject}
                onChange={(event) => onChange({ ...value, header: { ...value.header, subject: event.target.value } })}
              />
            </div>
            <div>
              <Label htmlFor="test-header-class">Třída</Label>
              <Input
                id="test-header-class"
                value={value.header.className}
                placeholder="prázdné = linka k doplnění"
                onChange={(event) =>
                  onChange({ ...value, header: { ...value.header, className: event.target.value } })
                }
              />
            </div>
            <div>
              <Label htmlFor="test-header-date">Datum</Label>
              <Input
                id="test-header-date"
                value={value.header.date}
                placeholder="prázdné = linka k doplnění"
                onChange={(event) => onChange({ ...value, header: { ...value.header, date: event.target.value } })}
              />
            </div>
          </div>

          <div>
            <Label>Šablona</Label>
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
                  <TemplatePreview templateId={template.id} graded={value.graded} />
                  <span className="mt-1.5 block px-1 text-sm font-medium text-fg-soft">{template.name}</span>
                  <span className="block px-1 pb-1 text-xs text-fg-muted">{template.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Klíč správných odpovědí se tu nenastavuje: volí se až při tisku,
              kde se vybírá mezi „Zadání pro žáky" a „Klíč pro mě". */}
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-fg-soft">
              <Checkbox
                checked={value.graded}
                onCheckedChange={() => onChange({ ...value, graded: !value.graded })}
              />
              Test na známky (tiskne body a políčko na známku)
            </label>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
