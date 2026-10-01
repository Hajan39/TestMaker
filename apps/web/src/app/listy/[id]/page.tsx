import type { Metadata } from 'next'
import { t } from '@testmaker/core/i18n'
import { TestEditorPage } from '../../tests/TestEditorPage'

export const dynamic = 'force-dynamic'
export function generateMetadata(): Metadata {
  return { title: t('worksheets:meta.detail') }
}

export default async function WorksheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ vynechano?: string }>
}) {
  const { id } = await params
  const { vynechano: skipped } = await searchParams
  return <TestEditorPage id={id} kind="pracovni_list" skipped={skipped} />
}
