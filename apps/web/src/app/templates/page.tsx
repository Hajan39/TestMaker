import type { Metadata } from 'next'
import { t } from '@testmaker/core/i18n'
import { Badge, Card, EmptyState, PageShell } from '@testmaker/ui'
import { TemplatePreview } from '@/components/TemplatePreview'
import { loadTemplates } from '@/lib/tests'
import { pageAccount } from '@/lib/user'

export const dynamic = 'force-dynamic'
export function generateMetadata(): Metadata {
  return { title: t('tests:meta.templates') }
}

export default async function TemplatesPage() {
  const account = await pageAccount()
  const templates = await loadTemplates(account)

  return (
    <PageShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ui-page-title">{t('tests:templates.title')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-fg-soft">
              {t('tests:templates.intro')}
            </p>
          </div>
          <p className="text-sm text-fg-muted">{t('tests:templates.count', { count: templates.length })}</p>
        </div>

        {templates.length === 0 ? (
          <EmptyState title={t('tests:templates.empty.title')} hint={t('tests:templates.empty.hint')} />
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
                    {template.builtIn ? <Badge variant="secondary">{t('tests:templates.builtIn')}</Badge> : null}
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
