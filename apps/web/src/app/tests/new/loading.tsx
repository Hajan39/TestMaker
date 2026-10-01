import { t } from '@testmaker/core/i18n'
import { BuilderLoading } from '../BuilderLoading'

export default function NewTestLoading() {
  return <BuilderLoading label={t('tests:loading.bank')} />
}
