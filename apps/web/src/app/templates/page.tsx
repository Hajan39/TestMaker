import { Badge, Card } from '@testmaker/ui'
import { TemplatePreview } from '@/components/TemplatePreview'
import { loadTemplates } from '@/lib/tests'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Šablony – TestMaker' }

export default async function TemplatesPage() {
  const templates = await loadTemplates()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Šablony testů</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-600">
          Každý náhled je skutečná stránka PDF vykreslená stejným způsobem jako hotový test.
          Šablona je uložená jako nastavení, ne jako kód, takže editor vlastních šablon přibude
          bez zásahu do vykreslování.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.id} className="overflow-hidden">
            <TemplatePreview
              templateId={template.id}
              graded={template.config.showPoints}
              className="rounded-none border-0 border-b border-ink-200"
            />
            <div className="p-4">
              <div className="flex items-center gap-2">
                <h2 className="font-medium text-ink-900">{template.name}</h2>
                {template.builtIn ? <Badge>vestavěná</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-ink-600">{template.description}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
