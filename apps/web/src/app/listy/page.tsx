import type { Metadata } from 'next'
import { t } from '@testmaker/core/i18n'
import { TestsOverview, type OverviewParams } from '../tests/TestsOverview'

export const dynamic = 'force-dynamic'
export function generateMetadata(): Metadata {
  return { title: t('worksheets:meta.list') }
}

/**
 * Worksheets have their own tab: they are ungraded tests created from a topic
 * or from a free-form brief, and their items never go into the bank.
 */
export default async function WorksheetsPage({ searchParams }: { searchParams: Promise<OverviewParams> }) {
  return <TestsOverview kind="pracovni_list" params={await searchParams} />
}
