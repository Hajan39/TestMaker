import type { Metadata } from 'next'
import { t } from '@testmaker/core/i18n'
import { EmptyState, PageShell } from '@testmaker/ui'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTemplates } from '@/lib/tests'
import { TestBuilder } from '@/components/TestBuilder'
import { pageAccount } from '@/lib/user'
import { aiStatus } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export function generateMetadata(): Metadata {
  return { title: t('tests:meta.new') }
}

export default async function NewTestPage() {
  const account = await pageAccount()
  const [topics, templates] = await Promise.all([loadPickerTopics(account), loadTemplates(account)])
  // Without a template saving would be rejected — say so up front.
  if (templates.length === 0) {
    return (
      <PageShell>
        <EmptyState title={t('tests:noTemplate.title')} hint={t('tests:noTemplate.hint')} />
      </PageShell>
    )
  }
  return (
    <PageShell>
      <TestBuilder
        topics={topics}
        templates={templates}
        test={null}
        items={[]}
        role={account.role}
        ai={aiStatus()}
      />
    </PageShell>
  )
}
