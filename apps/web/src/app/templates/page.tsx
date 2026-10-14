import type { Metadata } from 'next'
import { t } from '@testmaker/core/i18n'
import { Badge, Card, EmptyState, PageShell } from '@testmaker/ui'
import { TEMPLATE_KINDS } from '@testmaker/core/schema'
import { KindMark } from '@/components/KindMark'
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
          // Test and worksheet templates apart: each is offered only to its own kind.
          TEMPLATE_KINDS.map((kind) => {
            const group = templates.filter((template) => template.config.kind === kind)
            if (group.length === 0) return null
            return (
              <section key={kind} className="space-y-3">
                <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
                  <KindMark kind={kind} />
                  {kind === 'pracovni_list' ? t('worksheets:overview.title') : t('tests:overview.title')}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {group.map((template) => (
                    <Card key={template.id} className="overflow-hidden p-0">
                      <TemplatePreview
                        templateId={template.id}
                        graded={template.config.showPoints}
                        className="rounded-none border-0 border-b border-line"
                      />
                      <div className="p-4">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-fg">{template.name}</h3>
                          {template.builtIn ? <Badge variant="secondary">{t('tests:templates.builtIn')}</Badge> : null}
                        </div>
                        <p className="mt-1 text-sm text-fg-soft">{template.description}</p>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </PageShell>
  )
}
