import { t } from '@testmaker/core/i18n'
import { BuilderLoading } from '../BuilderLoading'

export default function TestLoading() {
  return <BuilderLoading label={t('tests:loading.test')} />
}
