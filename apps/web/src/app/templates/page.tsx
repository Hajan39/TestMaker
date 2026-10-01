import { Badge, Card, EmptyState, PageShell, pocet } from '@testmaker/ui'
import { TemplatePreview } from '@/components/TemplatePreview'
import { loadTemplates } from '@/lib/tests'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Šablony – TestMaker' }

export default async function TemplatesPage() {
  const ucet = await ucetStranky()
  const templates = await loadTemplates(ucet)

  return (
    <PageShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ui-page-title">Šablony testů</h1>
            <p className="mt-1 max-w-3xl text-sm text-fg-soft">
              Šablona určuje, jak písemka vypadá na papíře. Náhled ukazuje skutečnou stránku tak, jak se
              vytiskne; šablonu si vybereš v nastavení písemky.
            </p>
          </div>
          <p className="text-sm text-fg-muted">{pocet(templates.length, ['šablona', 'šablony', 'šablon'])}</p>
        </div>

        {templates.length === 0 ? (
          <EmptyState
            title="Zatím tu není žádná šablona"
            hint="Bez šablony nejde písemku vytisknout. Dej vědět správci, ať ji přidá."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <Card key={template.id} className="overflow-hidden">
                <TemplatePreview
                  templateId={template.id}
                  graded={template.config.showPoints}
                  className="rounded-none border-0 border-b border-line"
                />
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium text-fg">{template.name}</h2>
                    {template.builtIn ? <Badge variant="secondary">vestavěná</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-fg-soft">{template.description}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
